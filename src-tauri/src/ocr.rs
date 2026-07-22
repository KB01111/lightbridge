use std::io::Cursor;
use std::path::Path;

use anyhow::{anyhow, Context, Result};
use image::{DynamicImage, ImageFormat};

/// Run OCR on a PNG/JPEG path. Uses Windows.Media.Ocr when available.
pub fn ocr_image_path(path: &Path) -> Result<String> {
    let bytes = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
    let img = image::load_from_memory(&bytes).context("decode image for ocr")?;
    ocr_image(&img)
}

pub fn ocr_image(img: &DynamicImage) -> Result<String> {
    #[cfg(windows)]
    {
        ocr_windows(img)
    }
    #[cfg(not(windows))]
    {
        let _ = img;
        anyhow::bail!("OCR is only supported on Windows");
    }
}

#[cfg(windows)]
fn ocr_windows(img: &DynamicImage) -> Result<String> {
    use windows::core::HSTRING;
    use windows::Graphics::Imaging::{BitmapDecoder, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

    // Encode as PNG into WinRT stream
    let mut png = Vec::new();
    img.write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .context("png for ocr")?;

    let text = std::thread::scope(|s| {
        s.spawn(|| -> Result<String> {
            // WinRT APIs are apartment-aware; run on this worker thread.
            let stream = InMemoryRandomAccessStream::new()?;
            {
                let writer = DataWriter::CreateDataWriter(&stream)?;
                writer.WriteBytes(&png)?;
                // Flush async → block
                let op = writer.StoreAsync()?;
                let _ = op.get()?;
                writer.DetachStream()?;
            }
            stream.Seek(0)?;

            let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
            let software_bitmap: SoftwareBitmap = decoder.GetSoftwareBitmapAsync()?.get()?;

            // Convert to gray8 / bgra8 if needed for OCR
            let bitmap = if software_bitmap.BitmapPixelFormat()? != BitmapPixelFormat::Bgra8 {
                SoftwareBitmap::Convert(&software_bitmap, BitmapPixelFormat::Bgra8)?
            } else {
                software_bitmap
            };

            let engine = OcrEngine::TryCreateFromUserProfileLanguages()
                .map_err(|e| anyhow!("OcrEngine create: {e}"))?;
            let result = engine.RecognizeAsync(&bitmap)?.get()?;
            let h: HSTRING = result.Text()?;
            Ok(h.to_string())
        })
        .join()
        .map_err(|_| anyhow!("ocr thread panicked"))?
    })?;

    Ok(text.trim().to_string())
}
