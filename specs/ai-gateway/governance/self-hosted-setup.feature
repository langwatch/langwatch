Feature: AI Gateway Governance — Self-Hosted Setup + Endpoint Discovery
  As a self-hosted LangWatch operator OR an end user pointing at a
  non-default LangWatch deployment
  I want a discoverable install path that handles npm prerequisites,
  endpoint configuration, and persistent session storage at predictable
  filesystem paths
  So that the dev/UX experience is identical regardless of whether the
  user signs into app.langwatch.ai or langwatch.acme.internal

  Per gateway.md "self-hosted setup":
    Three knobs determine a CLI session's binding:
      1. install discovery — `curl https://install.langwatch.ai | sh`
         OR `npm install -g langwatch` (both supported, both documented)
      2. endpoint config — `LANGWATCH_ENDPOINT` env var OR `--endpoint` flag
         OR `~/.langwatch/config.json` persisted from prior login
      3. session storage — `~/.langwatch/sessions/<endpoint-host>.json`
         (per-host, so a user with both SaaS and self-hosted can keep
         separate sessions without one clobbering the other)

  Per cli-login.feature + cli-deep-links.feature:
    The login flow already covers the device-code dance. THIS spec
    covers the endpoint and storage layer underneath that flow.

  Background:
    Given the user's machine has Node 18+ AND npm in PATH
    And the user has no prior LangWatch CLI installed

  # ---------------------------------------------------------------------------
  # Install discovery
  # ---------------------------------------------------------------------------

  @bdd @self-hosted-setup @install
  Scenario: User installs via curl-pipe to shell
    When the user runs `curl https://install.langwatch.ai | sh`
    Then the script verifies Node 18+ presence (exits with a clear error
        message + remediation link if missing — `nvm install 18` or distro
        package hint)
    And the script runs `npm install -g langwatch` under the hood
    And the script prints a final summary: install path, version installed,
        next-step hint `langwatch login` (no --endpoint flag — defaults to
        https://app.langwatch.ai)
    And no `~/.langwatch/` directory is created until the first sign-in

  @bdd @self-hosted-setup @install @npm-fallback
  Scenario: User installs directly via npm (works on machines that disallow curl-pipe)
    When the user runs `npm install -g langwatch`
    Then the CLI is installed at the npm prefix
    And subsequent `langwatch --version` prints the installed version
    # Some enterprise environments prohibit curl-pipe-to-shell. The
    # npm direct install is the canonical fallback documented at
    # /docs/ai-governance/self-hosted-setup#install.

  # ---------------------------------------------------------------------------
  # Endpoint discovery
  # ---------------------------------------------------------------------------

  @bdd @self-hosted-setup @endpoint @resolution-order
  Scenario: Endpoint resolution follows a deterministic order
    When the CLI resolves `endpoint` for a command
    Then the order is:
      | priority | source                                                  |
      | 1        | `--endpoint` flag passed on the current command         |
      | 2        | `LANGWATCH_ENDPOINT` env var                            |
      | 3        | `~/.langwatch/config.json` (`defaultEndpoint` field)    |
      | 4        | hardcoded fallback `https://app.langwatch.ai`           |
    And the FIRST match wins; downstream sources are NOT consulted

  @bdd @self-hosted-setup @endpoint @explicit-flag
  Scenario: --endpoint flag overrides everything for the current command
    Given `LANGWATCH_ENDPOINT=https://saas.langwatch.ai` is set in the env
    When the user runs `langwatch login --endpoint https://langwatch.acme.internal`
    Then the command targets `https://langwatch.acme.internal`
    And the env var is NOT consulted for THIS command

  @bdd @self-hosted-setup @endpoint @env-var
  Scenario: LANGWATCH_ENDPOINT env var is honored for non-flag commands
    Given the env exports `LANGWATCH_ENDPOINT=https://langwatch.acme.internal`
    And no `--endpoint` flag is passed
    When the user runs `langwatch login --device`
    Then the device-code flow targets `https://langwatch.acme.internal/auth/device`
    And the resulting session is stored under that endpoint's namespace

  # ---------------------------------------------------------------------------
  # Session storage layout — per-endpoint isolation
  # ---------------------------------------------------------------------------

  @bdd @self-hosted-setup @storage @per-endpoint
  Scenario: Sessions are stored per-endpoint to avoid cross-deployment clobber
    Given the user signs into `https://app.langwatch.ai` and gets a session
    When they sign into `https://langwatch.acme.internal` (their self-hosted)
    Then `~/.langwatch/sessions/app.langwatch.ai.json` exists with the SaaS session
    And `~/.langwatch/sessions/langwatch.acme.internal.json` exists with the self-hosted session
    And neither file is overwritten by the other
    # Without per-endpoint storage, dual-deployment users would re-login
    # constantly. With it, each endpoint has its own credential without
    # the user having to manage explicit profile flags.

  @bdd @self-hosted-setup @storage @config-file
  Scenario: ~/.langwatch/config.json persists the user's preferred default endpoint
    Given the user signed into `https://langwatch.acme.internal` first
    When the CLI resolves endpoint with no flag and no env var
    Then the resolution falls through to `~/.langwatch/config.json`
        which stores `{ "defaultEndpoint": "https://langwatch.acme.internal" }`
    And subsequent commands target that endpoint

  # ---------------------------------------------------------------------------
  # CLI behavior on misconfiguration
  # ---------------------------------------------------------------------------

  @bdd @self-hosted-setup @misconfiguration
  Scenario: Unreachable endpoint surfaces a clear error
    Given the user runs `langwatch login --endpoint https://langwatch.broken.example`
    When the CLI fails to reach the endpoint after the connect-timeout
    Then the CLI exits non-zero with the message:
        "Endpoint https://langwatch.broken.example unreachable.
         Check the URL, your network, and that LangWatch is running there.
         For self-hosted help: /docs/ai-governance/self-hosted-setup#troubleshooting"
    And NO session file is written

  @bdd @self-hosted-setup @endpoint @auto-trigger
  Scenario: Running a command without prior login auto-triggers the login flow
    Given no `~/.langwatch/sessions/<endpoint>.json` exists
    When the user runs `langwatch claude "hello"` (or any wrapper command)
    Then the CLI prints: "Not signed in to <endpoint>. Starting login flow..."
    And the device-code flow opens the browser at the resolved endpoint
    And on success the original command resumes
    # Captures rchaves's prompt: "why don't we trigger the login flow
    # automatically if not logged in?" — the friendly default.

  # ---------------------------------------------------------------------------
  # Self-hosted vs SaaS detection
  # ---------------------------------------------------------------------------

  @bdd @self-hosted-setup @saas-vs-self-hosted
  Scenario: SaaS endpoint detection is purely host-based, not feature-flag-based
    Given the resolved endpoint host is "app.langwatch.ai" (or "*.langwatch.ai")
    Then the CLI considers the deployment SaaS for diagnostic purposes only
        (e.g. "Need help? https://app.langwatch.ai/support")
    And the SAME CLI binary works against any self-hosted instance
        (no per-deployment build artifacts; one binary, one set of code paths)
