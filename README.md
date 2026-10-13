<h1>
  <img src="src-tauri/icons/128x128.png" width="42" alt="Logo do OrganicCord" />
  OrganicCord
</h1>

Um cliente leve e multi-conta para Discord, de código aberto, construído com Tauri, Rust, React e TypeScript. Este fork dá suporte ao Linux, com build `AppImage`.

> [!WARNING]
> OrganicCord é um cliente **não oficial** do Discord. A Discord não oferece uma API pública completa para clientes de usuário, então mudanças no serviço podem afetar a compatibilidade. Não use este projeto para automação de contas, spam, coleta de dados ou self-bots. Mantenha o cliente oficial do Discord disponível para contas importantes.

<p align="center">
  <img src="docs/assets/organiccord-friends-preview.png" alt="Prévia anonimizada da interface de Amigos do OrganicCord" width="100%" />
</p>

*Prévia anonimizada da tela de Amigos do OrganicCord.*

## Status beta

O OrganicCord é publicado na [página de releases deste fork](https://github.com/LucianoSkx/OrganicCord/releases). Esta release expande o cliente leve com processamento de voz melhorado, presença de jogos e uma experiência de chat mais responsiva. Não pretende igualar todos os recursos do cliente oficial do Discord.

| Disponível agora | Ainda não disponível |
| --- | --- |
| Mensagens, DMs, servidores, amigos e presença | Chamadas de vídeo |
| Chamadas de voz em DMs e canais de voz | Compartilhamento de tela / Go Live |
| Anexos, reações, respostas, enquetes e fóruns | Activities, soundboard e Stage Channels |
| Notificações nativas, temas, atalhos e multi-conta | Atualizações automáticas e suporte oficial a macOS |

## Windows

Este fork dá suporte apenas ao Linux. No Windows, use o instalador do [projeto original](https://github.com/aMathyzinn/OrganicCord/releases) — não é assinado, então o Windows pode avisar sobre publicante desconhecido. Verifique o SHA-256 antes de instalar e não desative recursos de segurança para rodar o app.

## Instalar no Linux (suporte de primeira classe)

A build Linux produz `AppImage`. Voz, gateway, anexos, notificações, multi-conta e login por QR estão funcionando; detecção de jogos também corresponde a processos Linux/Proton. Compartilhamento de tela não está disponível em nenhuma plataforma ainda.

1. Baixe o `OrganicCord_<versão>_amd64.AppImage` da [página de releases](https://github.com/LucianoSkx/OrganicCord/releases) e torne-o executável: `chmod +x OrganicCord_*.AppImage`.
2. Mantenha o stack de portal de desktop disponível para notificações e ícone da bandeja. A bandeja precisa de `libayatana-appindicator` / `libappindicator-gtk3`; sem ele o app ainda inicia, só sem a bandeja.
3. Rich Presence via `discord_ipc` funciona quando o Discord Desktop roda na mesma máquina (expõe o mesmo IPC sobre sockets Unix).

Logs de diagnóstico vão para `$XDG_STATE_HOME/OrganicCord/logs` (`$HOME/.local/state/OrganicCord/logs` por padrão). Se o cofre do sistema (secret-service/KWallet) estiver indisponível, a chave de criptografia usa um arquivo restrito ao usuário (`$XDG_DATA_HOME/OrganicCord/encryption_key`, modo `0600`), e o app avisa no log ao iniciar.

## O que você pode fazer

### Conversas e comunidades

- Use múltiplas contas do Discord em um aplicativo e alterne entre elas rapidamente.
- Navegue por servidores, organize em pastas e acesse canais de texto, voz e fórum.
- Envie, responda, edite e apague suas próprias mensagens.
- Envie arquivos e imagens, grave mensagens de voz e veja embeds.
- Use emojis, reações, enquetes, mensagens fixadas, busca e formatação Markdown.
- Converse por DMs, arquive conversas e veja indicadores de digitação, presença e perfis.
- Gerencie amigos, bloqueie usuários e crie convites de servidor quando tiver permissão.

### Voz

- Inicie, receba, responda e recuse chamadas de voz em DM.
- Entre e saia de canais de voz de servidores.
- Selecione dispositivos de entrada e saída de áudio, teste o microfone e ative a supressão RNNoise.
- Silencie, abafe, acompanhe participantes e inspecione o estado da conexão ativa.

O transporte de voz usa Opus. Uma chamada só é tratada como conectada depois que o gateway de voz, o transporte criptografado e a proteção DAVE completam a negociação; um estado visível na interface sozinho não é prova de uma chamada funcionando.

### Experiência desktop

- Receba notificações nativas, alertas de menções e indicadores de não lidas.
- Silencie servidores, canais ou usuários por um período escolhido.
- Customise temas, contraste, densidade, tamanho das mensagens, ícone do app e atalhos de teclado.
- Atualize seu avatar, bio e cor do perfil. Imagens de banner continuam sujeitas à elegibilidade da conta no Discord.
- Detecte jogos locais suportados e publique uma presença básica de "Jogando" diretamente pela conta OrganicCord ativa, sem exigir o Discord Desktop.

## Arquitetura técnica

```text
React + TypeScript + Zustand
        │ UI e estado local
        ▼
Tauri 2 — comandos e eventos tipados
        │
Rust — sessões, REST, Gateway, permissões, voz e arquivos
        │
Discord API v10 · Gateway · Voice Gateway
```

| Camada | Responsabilidade |
| --- | --- |
| React + Zustand | Interface, navegação, cache de mensagens e estado de chamada. |
| Tauri | Ponte tipada entre o frontend e capacidades nativas do sistema. |
| Rust | Sessões, REST, tratamento de Gateway, rate limits, permissões, áudio e anexos. |
| Gateway v10 | Eventos em tempo real, heartbeats, reconexão e resume de sessão. |
| Voz | Opus, dispositivos de áudio, transporte RTP criptografado e negociação DAVE fail-closed. |

Permissões são avaliadas em servidor, cargo, membro e sobrescritas de canal. Limites de requisição são coordenados por rota, com tratamento separado para limites globais.

## Segurança e privacidade

- O frontend não recebe nem persiste tokens de conta do Discord.
- Credenciais locais são criptografadas, com chaves protegidas pelo sistema operacional.
- Arquivos selecionados no disco viram identificadores opacos e temporários, com expiração e limite de tamanho, antes do upload.
- A Content Security Policy restringe origens de script, conexão, mídia e navegação embutida.
- Links externos são validados e exigem confirmação antes de abrir o navegador padrão.

Essas medidas reduzem a superfície de ataque, mas não eliminam os riscos inerentes a um cliente não oficial. Leia a [Política de segurança](SECURITY.md) para reportar vulnerabilidades.

## Desenvolvimento

### Requisitos

O toolchain Rust está fixado em [`rust-toolchain`](rust-toolchain).

- **Linux**: `libwebkit2gtk-4.1`, `libgtk-3`, `librsvg`, `libasound2` e `patchelf` para compilar; `libayatana-appindicator3` / `libappindicator-gtk3` para o ícone da bandeja;
- **Ambos**: Node.js 24 (`>=24 <25`) e Rust `1.89.0`.

```bash
# Debian/Ubuntu
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libasound2-dev patchelf

# Arch
sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl \
  xdotool libayatana-appindicator librsvg alsa-lib patchelf
```

### Rodar localmente

```bash
npm ci
npm run tauri:dev
```

Gere o `AppImage`:

```bash
npm run tauri:build
```

Em algumas distribuições o linuxdeploy traz um `strip` antigo que falha em seções `RELR`; gere o AppImage com `NO_STRIP=1 npm run tauri:build -- --bundles appimage`.

### Validar o projeto

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

## Documentação e contribuição

- [Guia de contribuição](CONTRIBUTING.md)
- [Política de segurança](SECURITY.md)
- [Repositório deste fork](https://github.com/LucianoSkx/OrganicCord)
- [Autor do projeto original](https://damodara.xyz)

Mudanças de protocolo devem referenciar a documentação oficial sempre que disponível, incluir testes e evitar afirmações de compatibilidade sem evidência real de transporte, criptografia e mídia.

## Licença

OrganicCord é distribuído sob licença MIT. A cópia adaptada de [`hpke-rs`](src-tauri/vendor/hpke-rs) permanece sob MPL-2.0; veja o [`PATCH.md`](src-tauri/vendor/hpke-rs/PATCH.md).
