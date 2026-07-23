use std::io::Cursor;
use std::path::Path;

use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use chrono::Utc;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::models::{CaptureRecord, WindowInfo};

const SELF_TITLE: &str = "LightBridge";
const SELF_PROCESS_MARKERS: &[&str] = &["lightbridge", "LightBridge"];

#[cfg(windows)]
pub fn resolve_foreground_window(exclude_hwnd: Option<u64>) -> Result<WindowInfo> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        bail!("No foreground window is available.");
    }
    resolve_window(hwnd.0 as u64, exclude_hwnd)
}

#[cfg(windows)]
pub fn resolve_window(hwnd_value: u64, exclude_hwnd: Option<u64>) -> Result<WindowInfo> {
    use windows::Win32::Foundation::{HMODULE, HWND, MAX_PATH, RECT};
    use windows::Win32::System::ProcessStatus::GetModuleFileNameExW;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow,
    };

    unsafe {
        let hwnd = HWND(hwnd_value as *mut _);
        if !IsWindow(hwnd).as_bool() {
            bail!("The captured window is no longer available. Focus it and recapture.");
        }
        if let Some(ex) = exclude_hwnd {
            if hwnd_value == ex {
                bail!("LightBridge cannot capture itself. Focus another window and recapture.");
            }
        }
        if IsIconic(hwnd).as_bool() {
            bail!("The captured window is minimized. Restore it and recapture.");
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            bail!("The captured window process is unavailable. Recapture another window.");
        }

        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut title_buf);
        let title = String::from_utf16_lossy(&title_buf[..title_len as usize]);

        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect)?;

        let dpi = GetDpiForWindow(hwnd);

        let process_path = {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
                .context("OpenProcess")?;
            let mut path_buf = [0u16; MAX_PATH as usize];
            let n = GetModuleFileNameExW(handle, HMODULE::default(), &mut path_buf);
            let _ = windows::Win32::Foundation::CloseHandle(handle);
            if n == 0 {
                String::new()
            } else {
                String::from_utf16_lossy(&path_buf[..n as usize])
            }
        };

        let app_name = Path::new(&process_path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Unknown".into());

        let info = WindowInfo {
            hwnd: hwnd_value,
            process_id: pid,
            process_path,
            app_name,
            title,
            x: rect.left,
            y: rect.top,
            width: (rect.right - rect.left).max(0),
            height: (rect.bottom - rect.top).max(0),
            dpi: if dpi == 0 { 96 } else { dpi },
            monitor: format!("{}x{}", rect.right - rect.left, rect.bottom - rect.top),
        };

        if is_self_window(&info) {
            bail!("LightBridge cannot capture itself. Focus another window and recapture.");
        }
        Ok(info)
    }
}

#[cfg(not(windows))]
pub fn resolve_foreground_window(_exclude_hwnd: Option<u64>) -> Result<WindowInfo> {
    bail!("window capture is only supported on Windows");
}

#[cfg(not(windows))]
pub fn resolve_window(_hwnd: u64, _exclude_hwnd: Option<u64>) -> Result<WindowInfo> {
    bail!("window capture is only supported on Windows");
}

pub fn is_self_window(info: &WindowInfo) -> bool {
    if info.title.contains(SELF_TITLE) {
        return true;
    }
    let path_l = info.process_path.to_lowercase();
    let name_l = info.app_name.to_lowercase();
    SELF_PROCESS_MARKERS.iter().any(|m| {
        let m = m.to_lowercase();
        path_l.contains(&m) || name_l.contains(&m)
    })
}

pub fn capture_window_image(info: &WindowInfo) -> Result<DynamicImage> {
    #[cfg(windows)]
    {
        use xcap::Window;
        let windows = Window::all().map_err(|e| anyhow!("enumerate windows: {e}"))?;
        let target = windows
            .into_iter()
            .find(|w| w.id() as u64 == info.hwnd)
            .ok_or_else(|| {
                anyhow!("The captured window is no longer available. Focus it and recapture.")
            })?;

        if target.title().contains(SELF_TITLE) {
            bail!("refusing to capture LightBridge window via xcap");
        }

        let img = target.capture_image().map_err(|_| {
            anyhow!(
                "Windows blocked this capture or the window stopped responding. \
                     Protected video and secure surfaces cannot be captured."
            )
        })?;
        // xcap returns RgbaImage
        Ok(DynamicImage::ImageRgba8(img))
    }
    #[cfg(not(windows))]
    {
        let _ = info;
        bail!("capture only on Windows");
    }
}

pub fn persist_capture(
    captures_dir: &Path,
    info: WindowInfo,
    image: DynamicImage,
) -> Result<CaptureRecord> {
    std::fs::create_dir_all(captures_dir)?;
    let id = Uuid::new_v4().to_string();
    let png_path = captures_dir.join(format!("{id}.png"));

    let mut full_bytes = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut full_bytes), ImageFormat::Png)
        .context("encode full png")?;
    std::fs::write(&png_path, &full_bytes)?;

    let mut hasher = Sha256::new();
    hasher.update(&full_bytes);
    let content_hash = hex::encode(hasher.finalize());

    let preview = make_preview_jpeg_base64(&image)?;

    Ok(CaptureRecord {
        id,
        window: info,
        image_path: png_path.to_string_lossy().to_string(),
        preview_base64: preview,
        content_hash,
        ocr_text: None,
        ocr_status: "pending".into(),
        created_at: Utc::now(),
    })
}

fn make_preview_jpeg_base64(image: &DynamicImage) -> Result<String> {
    let thumb = image.resize(640, 360, FilterType::Triangle);
    let mut bytes = Vec::new();
    thumb
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Jpeg)
        .context("encode preview jpeg")?;
    Ok(format!("data:image/jpeg;base64,{}", B64.encode(bytes)))
}

pub fn make_api_image_base64(path: &Path) -> Result<String> {
    let image = image::open(path).context("open selected capture")?;
    let bounded = image.resize(2048, 2048, FilterType::Lanczos3);
    let rgb = bounded.to_rgb8();
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 88)
        .encode_image(&rgb)
        .context("encode selected capture")?;
    Ok(format!("data:image/jpeg;base64,{}", B64.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_image_is_jpeg_and_bounded_to_2048_pixels() {
        let dir = std::env::temp_dir().join(format!("lb-image-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fixture.png");
        DynamicImage::new_rgb8(3000, 1000).save(&path).unwrap();
        let encoded = make_api_image_base64(&path).unwrap();
        let bytes = B64
            .decode(encoded.strip_prefix("data:image/jpeg;base64,").unwrap())
            .unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!(decoded.width(), 2048);
        assert!(decoded.height() <= 2048);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[test]
    fn exact_hwnd_resolution_rejects_destroyed_window() {
        let error = resolve_window(u64::MAX, None).unwrap_err().to_string();
        assert!(error.contains("no longer available"));
    }
}
