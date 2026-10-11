<h1>
  <img src="src-tauri/icons/128x128.png" width="42" alt="OrganicCord logo" />
  OrganicCord
</h1>

An open-source, lightweight, multi-account desktop client for Discord. OrganicCord brings conversations, communities, voice, presence, and notifications into a focused native desktop experience built with Tauri, Rust, React, and TypeScript. Windows is the reference platform; a Linux build is also available (see [Install on Linux](#install-on-linux-experimental)).

> [!WARNING]
> OrganicCord is an **unofficial** Discord client. Discord does not provide a public, supported API for complete user clients, so service changes can affect compatibility. Do not use this project for account automation, spam, data harvesting, or self-bots. Keep the official Discord client available for important accounts.

<p align="center">
  <img src="docs/assets/organiccord-friends-preview.png" alt="An anonymized OrganicCord Friends interface preview" width="100%" />
</p>

*An anonymized preview of the OrganicCord Friends interface.*

## Beta status

OrganicCord is currently published as [`v0.3.0-beta.1`](https://github.com/aMathyzinn/OrganicCord/releases/tag/v0.3.0-beta.1). This release expands the lightweight desktop client with improved voice processing, game presence, and a more responsive chat experience. It is not intended to match every feature of the official Discord client.

| Available now | Not available yet |
| --- | --- |
| Messages, DMs, servers, friends, and presence | Video calls |
| Voice calls in DMs and voice channels | Screen sharing / Go Live |
| Attachments, reactions, replies, polls, and forums | Activities, soundboard, and Stage Channels |
| Native notifications, themes, shortcuts, and multi-account sessions | Automatic updates and official macOS support |

## Install on Windows

1. Download `OrganicCord_0.3.0-beta.1_x64-setup.exe` from the [release page](https://github.com/aMathyzinn/OrganicCord/releases/tag/v0.3.0-beta.1).
2. Run the installer on a Windows 10 or Windows 11 computer with WebView2 installed.
3. Sign in and grant only the permissions required by the features you choose to use.

The current installer is not code-signed yet. Windows may show an unknown publisher warning; verify that the file came from the official release and check its hash before installing. Do not disable Windows security features to run the app.

```powershell
Get-FileHash .\OrganicCord_0.3.0-beta.1_x64-setup.exe -Algorithm SHA256
```

`v0.3.0-beta.1` SHA-256:

```text
4ED50107A54324694462F48CA2AFCF374838EA6AE075C90B458EF30059A00FED
```

## Install on Linux (experimental)

The Linux build produces a `.deb` and an `AppImage`. Voice, gateway, attachments, notifications, multi-account, and the login webview are functional; game detection also matches Linux/Proton processes. Screen sharing is not available on any platform yet.

1. Install `OrganicCord_0.3.0-beta.1_amd64.deb` (or run the `AppImage`).
2. Keep the desktop portal stack available for notifications and the tray icon. The tray needs `libayatana-appindicator` / `libappindicator-gtk3`; without it the app still starts, just without the tray.
3. Rich Presence via `discord_ipc` works when Discord Desktop runs on the same machine (it exposes the same IPC over Unix sockets).

Diagnostic logs go to `$XDG_STATE_HOME/OrganicCord/logs` (`$HOME/.local/state/OrganicCord/logs` by default). If the system keyring (secret-service/KWallet) is unavailable, the encryption key falls back to a file restricted to the user (`$XDG_DATA_HOME/OrganicCord/encryption_key`, mode `0600`), and the app logs a warning on startup.

## What you can do

### Conversations and communities

- Use multiple Discord accounts from one application and switch between them quickly.
- Browse servers, organize them into folders, and access text, voice, and forum channels.
- Send, reply to, edit, and delete your own messages.
- Upload files and images, record voice messages, and view embeds.
- Use emojis, reactions, polls, pinned messages, search, and Markdown formatting.
- Chat through DMs, archive conversations, and view typing indicators, presence, and profiles.
- Manage friends, block users, and create server invites when you have permission.

### Voice

- Start, receive, answer, and decline direct-message voice calls.
- Join and leave server voice channels.
- Select audio input and output devices, test the microphone, and enable RNNoise suppression.
- Mute, deafen, follow participants, and inspect the active connection state.

Voice transport uses Opus. A call is only treated as connected after the voice gateway, encrypted transport, and DAVE protection have completed their negotiation; a visible UI state alone is not proof of a working call.

### Desktop experience

- Receive native Windows notifications, mention alerts, and unread indicators.
- Mute servers, channels, or users for a chosen duration.
- Customize themes, contrast, density, message size, app icon, and keyboard shortcuts.
- Update your avatar, bio, and profile color. Image banners remain subject to Discord account eligibility.
- Detect supported local games and publish a basic “Playing” presence directly through the active OrganicCord account, without requiring Discord Desktop.

## Technical architecture

```text
React + TypeScript + Zustand
        │ UI and local state
        ▼
Tauri 2 — typed commands and events
        │
Rust — sessions, REST, Gateway, permissions, voice, and files
        │
Discord API v10 · Gateway · Voice Gateway
```

| Layer | Responsibility |
| --- | --- |
| React + Zustand | Interface, navigation, message cache, and call state. |
| Tauri | Typed bridge between the frontend and native OS capabilities. |
| Rust | Sessions, REST, Gateway handling, rate limits, permissions, audio, and attachment handling. |
| Gateway v10 | Real-time events, heartbeats, reconnection, and session resume. |
| Voice | Opus, audio devices, encrypted RTP transport, and fail-closed DAVE negotiation. |

Permissions are evaluated across server, role, member, and channel overrides. Request limits are coordinated per route, with separate handling for global rate limits.

## Security and privacy

- The frontend does not receive or persist Discord account tokens.
- Local credentials are encrypted, with keys protected by the operating system.
- Files selected on disk become opaque, temporary identifiers with expiration and size limits before they are uploaded.
- The Content Security Policy restricts script, connection, media, and embedded-navigation origins.
- External links are validated and require confirmation before the default browser is opened.

These measures reduce the attack surface, but do not eliminate the risks inherent to an unofficial client. Read the [Security Policy](SECURITY.md) to report vulnerabilities.

## Development

### Requirements

Platform-specific; the Rust toolchain is pinned in [`rust-toolchain`](rust-toolchain).

- **Windows**: Windows 10 or 11 with WebView2, and Visual Studio C++ Build Tools for the audio backend;
- **Linux**: `libwebkit2gtk-4.1`, `libgtk-3`, `librsvg`, `libasound2` and `patchelf` for building; `libayatana-appindicator3` / `libappindicator-gtk3` for the tray icon;
- **Both**: Node.js 24 (`>=24 <25`) and Rust `1.89.0`.

```bash
# Debian/Ubuntu
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libasound2-dev patchelf

# Arch
sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl \
  xdotool libayatana-appindicator librsvg alsa-lib patchelf
```

### Run locally

```bash
npm ci
npm run tauri:dev
```

Bundle for the current platform (Windows produces the NSIS installer, Linux produces `.deb` and `AppImage`):

```bash
npm run tauri:build
```

On some distributions linuxdeploy ships an old `strip` that fails on `RELR` sections; build the AppImage with `NO_STRIP=1 npm run tauri:build -- --bundles appimage`.

### Validate the project

```bash
npm run type-check
npm run lint
npm test
npm run build

cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets
cargo audit
```

### Build a local NSIS installer

```powershell
$env:CARGO_TARGET_DIR = "$PWD\src-tauri\target-installer"
npm run tauri:build -- --bundles nsis
```

Using an isolated build directory avoids conflicts with an already-running OrganicCord instance. Always verify an installer by version, timestamp, and SHA-256 before distributing it.

## Documentation and contributing

- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Official repository](https://github.com/aMathyzinn/OrganicCord)
- [Creator portfolio](https://damodara.xyz)

Protocol changes should reference official documentation whenever available, include tests, and avoid compatibility claims without real transport, encryption, and media evidence.

## License

OrganicCord is released under the MIT License. The adapted copy of [`hpke-rs`](src-tauri/vendor/hpke-rs) remains under MPL-2.0; see its [`PATCH.md`](src-tauri/vendor/hpke-rs/PATCH.md).
