# LightBridge release boundaries

The current tree is a production-candidate Windows MVP:

- Exact-HWND window capture with local PNG retention and bounded JPEG upload
- On-device Windows OCR, capture progress, recapture, and actionable failures
- Managed Maxim Bifrost gateway with verified on-demand installation,
  loopback authentication, encrypted configuration, health reporting, and
  OpenAI-compatible multimodal Responses streaming
- OpenAI, Anthropic, Gemini, OpenRouter, Groq, Ollama, advanced Bifrost
  providers, and configurable Best/Balanced/Fast model routes
- A persistent edge-snapping status orb, translucent overlay, and dedicated
  Graphite Aurora settings window
- SQLite WAL/FTS5 persistence for chats, messages, captures, context, and settings
- Unified chat/capture/search library with restart hydration and confirmed deletion
- First-run privacy disclosure, sensitive-context indicators, diagnostics export,
  configurable shortcut, retention settings, and updater UI
- NSIS/MSI configuration, pull-request CI, native WebDriver coverage, and a
  tag-driven signed release workflow

## Deliberately deferred beyond v1

1. ChatKit and AgentOS/host actions
2. Document ingestion, embeddings, and vector retrieval
3. Cloud sync
4. Windows Graphics Capture fallback for protected content

## External release gates

The repository does not contain signing secrets. A public `1.0.0` release still
requires:

1. Replacing the updater public-key placeholder with the generated public key
2. Adding the updater private key to GitHub Actions secrets
3. Provisioning an Authenticode certificate and its CI secrets
4. Completing the interactive Windows 11 installer/update/uninstall checklist in
   `docs/release.md`

The workflow intentionally refuses to publish while these requirements are
missing.

## Runtime requirements

- Windows 11 x64
- WebView2
- Internet access during the first managed-gateway setup
- At least one Bifrost provider credential or a reachable external gateway
- Installed Windows OCR language for the content being captured

## Security posture

- The webview has no arbitrary filesystem, shell, provider HTTP, or global
  shortcut permissions
- Provider credentials never enter React and captured content is not logged
- Screenshot paths and source validation remain inside Rust
- Provider requests use `store: false` and never bypass Bifrost
- The managed gateway binds to loopback, requires a generated virtual key, and
  reads provider credentials through environment references
- Diagnostics exclude credentials and captured content by default
