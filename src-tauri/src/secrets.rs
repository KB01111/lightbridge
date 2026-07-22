use anyhow::{Context, Result};
use keyring::Entry;

const SERVICE: &str = "com.lightbridge.desktop";
const USER_OPENAI: &str = "openai_api_key";

pub fn set_openai_api_key(key: &str) -> Result<()> {
    let entry = Entry::new(SERVICE, USER_OPENAI).context("keyring entry")?;
    if key.trim().is_empty() {
        let _ = entry.delete_credential();
        return Ok(());
    }
    entry.set_password(key.trim()).context("set password")?;
    Ok(())
}

pub fn get_openai_api_key() -> Result<Option<String>> {
    let entry = Entry::new(SERVICE, USER_OPENAI).context("keyring entry")?;
    match entry.get_password() {
        Ok(p) if !p.is_empty() => Ok(Some(p)),
        Ok(_) => Ok(None),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e).context("get password"),
    }
}

pub fn has_openai_api_key() -> bool {
    matches!(get_openai_api_key(), Ok(Some(_)))
}
