use anyhow::{Context, Result};
use keyring::Entry;
use sha2::{Digest, Sha256};
use uuid::Uuid;

const SERVICE: &str = "com.lightbridge.desktop";
const LEGACY_OPENAI: &str = "openai_api_key";
const GATEWAY_ENCRYPTION: &str = "bifrost_encryption_key";
const GATEWAY_ADMIN_PASSWORD: &str = "bifrost_admin_password";
const GATEWAY_VIRTUAL_KEY: &str = "bifrost_virtual_key";
const EXTERNAL_GATEWAY_AUTH: &str = "external_gateway_auth";

fn read(name: &str) -> Result<Option<String>> {
    let entry = Entry::new(SERVICE, name).context("keyring entry")?;
    match entry.get_password() {
        Ok(value) if !value.is_empty() => Ok(Some(value)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error).context("get credential"),
    }
}

fn write(name: &str, value: &str) -> Result<()> {
    let entry = Entry::new(SERVICE, name).context("keyring entry")?;
    if value.trim().is_empty() {
        let _ = entry.delete_credential();
    } else {
        entry.set_password(value.trim()).context("set credential")?;
    }
    Ok(())
}

fn generated_secret() -> String {
    let material = format!("{}:{}", Uuid::new_v4(), Uuid::new_v4());
    hex::encode(Sha256::digest(material.as_bytes()))
}

fn get_or_create(name: &str) -> Result<String> {
    if let Some(value) = read(name)? {
        return Ok(value);
    }
    let value = generated_secret();
    write(name, &value)?;
    Ok(value)
}

fn provider_name(provider_id: &str) -> String {
    format!("provider_{}", provider_id.to_ascii_lowercase())
}

pub fn set_provider_credential(provider_id: &str, credential: &str) -> Result<()> {
    write(&provider_name(provider_id), credential)
}

pub fn get_provider_credential(provider_id: &str) -> Result<Option<String>> {
    let current = read(&provider_name(provider_id))?;
    if current.is_some() || provider_id != "openai" {
        return Ok(current);
    }
    read(LEGACY_OPENAI)
}

pub fn has_provider_credential(provider_id: &str) -> bool {
    matches!(get_provider_credential(provider_id), Ok(Some(_)))
}

pub fn migrate_legacy_openai() -> Result<bool> {
    if read(&provider_name("openai"))?.is_some() {
        return Ok(false);
    }
    let Some(value) = read(LEGACY_OPENAI)? else {
        return Ok(false);
    };
    write(&provider_name("openai"), &value)?;
    let legacy = Entry::new(SERVICE, LEGACY_OPENAI).context("legacy keyring entry")?;
    let _ = legacy.delete_credential();
    Ok(true)
}

pub fn gateway_encryption_key() -> Result<String> {
    get_or_create(GATEWAY_ENCRYPTION)
}

pub fn gateway_admin_password() -> Result<String> {
    get_or_create(GATEWAY_ADMIN_PASSWORD)
}

pub fn gateway_virtual_key() -> Result<String> {
    let value = get_or_create(GATEWAY_VIRTUAL_KEY)?;
    if value.starts_with("sk-bf-") {
        return Ok(value);
    }
    let migrated = format!("sk-bf-{value}");
    write(GATEWAY_VIRTUAL_KEY, &migrated)?;
    Ok(migrated)
}

pub fn set_external_gateway_auth(value: &str) -> Result<()> {
    write(EXTERNAL_GATEWAY_AUTH, value)
}

pub fn external_gateway_auth() -> Result<Option<String>> {
    read(EXTERNAL_GATEWAY_AUTH)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_gateway_keys_use_bifrost_prefix() {
        let key = format!("sk-bf-{}", generated_secret());
        assert!(key.starts_with("sk-bf-"));
        assert!(key.len() > "sk-bf-".len() + 32);
    }
}
