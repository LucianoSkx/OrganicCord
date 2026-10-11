use once_cell::sync::Lazy;
use reqwest::header::{HeaderValue, AUTHORIZATION};
use reqwest::{Client, IntoUrl, RequestBuilder};
use std::time::Duration;

static TRANSPORT: Lazy<Result<Client, String>> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .pool_idle_timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(2)
        .user_agent(concat!("OrganicCord/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("failed to build discord client: {e}"))
});

// The transport owns the pool; authentication belongs to each request, never to
// a shared default header. A request from another account cannot inherit it.
#[derive(Clone)]
pub struct DiscordClient {
    transport: Client,
    authorization: HeaderValue,
}

pub fn discord_client(token: &str) -> Result<DiscordClient, String> {
    let mut authorization =
        HeaderValue::from_str(token).map_err(|e| format!("invalid token header: {e}"))?;
    authorization.set_sensitive(true);
    Ok(DiscordClient {
        transport: TRANSPORT.as_ref().map_err(Clone::clone)?.clone(),
        authorization,
    })
}

macro_rules! authenticated_methods {
    ($($method:ident),+) => {
        impl DiscordClient {
            $(pub fn $method(&self, url: impl IntoUrl) -> RequestBuilder {
                self.transport.$method(url).header(AUTHORIZATION, self.authorization.clone())
            })+
        }
    };
}
authenticated_methods!(get, post, put, patch, delete);

#[cfg(test)]
mod transport_tests {
    use super::*;

    #[test]
    fn shared_transport_keeps_account_headers_separate() {
        let first = discord_client("account-one").unwrap();
        let second = discord_client("account-two").unwrap();
        let a = first
            .get("https://discord.com/api/v10/users/@me")
            .build()
            .unwrap();
        let b = second
            .post("https://discord.com/api/v10/channels/1/messages")
            .build()
            .unwrap();
        assert_eq!(a.headers()[AUTHORIZATION], "account-one");
        assert_eq!(b.headers()[AUTHORIZATION], "account-two");
        assert!(a.headers()[AUTHORIZATION].is_sensitive());
    }
}

/// Retry configuration for HTTP requests.
#[derive(Clone, Copy)]
pub struct RetryConfig {
    pub max_attempts: u32,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            base_delay_ms: 500,
            max_delay_ms: 10_000,
        }
    }
}

/// Computes the next backoff delay in ms using exponential backoff with ±20% jitter.
/// `attempt` is 0-based.
pub fn backoff_ms(attempt: u32, config: &RetryConfig) -> u64 {
    let exp = config.base_delay_ms.saturating_mul(1u64 << attempt.min(10));
    let capped = exp.min(config.max_delay_ms);
    // ±20% jitter using rand::random (0.0..1.0)
    let jitter_ratio = (rand::random::<f64>() - 0.5) * 0.4; // -0.2 to +0.2
    let jitter_ms = (capped as f64 * jitter_ratio) as i64;
    ((capped as i64) + jitter_ms).max(100) as u64
}
