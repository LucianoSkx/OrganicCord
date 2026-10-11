use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use keyring::Entry;
use zeroize::{Zeroize, Zeroizing};

const SERVICE_NAME: &str = "OrganicCord";
const KEY_ENTRY: &str = "encryption_key";

/// Obtém ou cria a chave de criptografia AES-256 armazenada no keychain do OS.
fn keyring_key() -> Result<Zeroizing<Vec<u8>>> {
    let entry = Entry::new(SERVICE_NAME, KEY_ENTRY).map_err(|e| anyhow!("Keyring error: {}", e))?;

    match entry.get_password() {
        Ok(mut stored) => {
            let key = BASE64.decode(&stored)?;
            stored.zeroize();
            if key.len() != 32 {
                return Err(anyhow!("Invalid key length"));
            }
            Ok(Zeroizing::new(key))
        }
        Err(keyring::Error::NoEntry) => {
            let mut key = Zeroizing::new(vec![0u8; 32]);
            OsRng.fill_bytes(&mut key);
            let encoded = Zeroizing::new(BASE64.encode(&*key));
            entry
                .set_password(&encoded)
                .map_err(|e| anyhow!("Could not store key: {}", e))?;
            Ok(key)
        }
        Err(error) => Err(anyhow!(
            "Não foi possível acessar o cofre seguro do sistema: {error}"
        )),
    }
}

#[cfg(target_os = "windows")]
fn keyring_is_unavailable(_error: &anyhow::Error) -> bool {
    false
}

/// Sessões Linux/BSD sem secret-service ou KWallet deixam o keyring
/// inacessível; nesse caso a chave fica em arquivo restrito ao usuário.
#[cfg(not(target_os = "windows"))]
fn keyring_is_unavailable(error: &anyhow::Error) -> bool {
    matches!(
        error.downcast_ref::<keyring::Error>(),
        Some(keyring::Error::PlatformFailure(_)) | Some(keyring::Error::NoStorageAccess(_))
    )
}

#[cfg(not(target_os = "windows"))]
fn fallback_key_path() -> Option<std::path::PathBuf> {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME")
                .map(|home| std::path::PathBuf::from(home).join(".local").join("share"))
        })?;
    Some(base.join("OrganicCord").join("encryption_key"))
}

#[cfg(not(target_os = "windows"))]
fn fallback_key() -> Result<Zeroizing<Vec<u8>>> {
    let path = fallback_key_path().ok_or_else(|| anyhow!("HOME/XDG_DATA_HOME indefinido"))?;

    if let Ok(stored) = std::fs::read(&path) {
        let key = Zeroizing::new(stored);
        if key.len() == 32 {
            return Ok(key);
        }
        return Err(anyhow!("Invalid key length"));
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut key = Zeroizing::new(vec![0u8; 32]);
    OsRng.fill_bytes(&mut key);

    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;

        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)?;
        file.write_all(&key)?;
    }

    #[cfg(not(unix))]
    std::fs::write(&path, &*key)?;

    Ok(key)
}

fn get_or_create_key() -> Result<Zeroizing<Vec<u8>>> {
    match keyring_key() {
        Ok(key) => Ok(key),
        Err(error) if keyring_is_unavailable(&error) => {
            log::warn!("[storage] O cofre do sistema está indisponível; a chave de criptografia usará um arquivo local com permissão 0600.");
            fallback_key()
        }
        Err(error) => Err(error),
    }
}

/// Criptografa um token Discord usando AES-256-GCM.
/// Retorna: base64(nonce || ciphertext)
pub fn encrypt_token(token: &str) -> Result<String> {
    let key_bytes = get_or_create_key()?;
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(key_bytes.as_slice());
    let cipher = Aes256Gcm::new(key);

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, token.as_bytes())
        .map_err(|_| anyhow!("Encryption failed"))?;

    let mut combined = nonce_bytes.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(BASE64.encode(combined))
}

/// Descriptografa um token Discord.
pub fn decrypt_token(encrypted: &str) -> Result<String> {
    let key_bytes = get_or_create_key()?;
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(key_bytes.as_slice());
    let cipher = Aes256Gcm::new(key);

    let combined = BASE64.decode(encrypted)?;
    if combined.len() < 12 {
        return Err(anyhow!("Invalid encrypted data"));
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| anyhow!("Decryption failed — invalid token or corrupted data"))?;

    String::from_utf8(plaintext).map_err(|e| anyhow!("UTF-8 error: {}", e))
}

/// Extrai os últimos 4 caracteres do token para exibição segura.
pub fn token_last_four(token: &str) -> String {
    let chars: Vec<char> = token.chars().collect();
    if chars.len() >= 4 {
        chars[chars.len() - 4..].iter().collect()
    } else {
        "****".to_string()
    }
}
