Feature: Unified `langwatch login` UX — endpoint + auth-mode + storage discipline
  As a developer onboarding to LangWatch (cloud or self-hosted, agentic or human)
  I want one canonical `langwatch login` command that asks me what I'm trying to
  do when I don't know, and gets out of the way when I pass flags
  So that I don't need to learn three different login flows or remember which
  env-var goes where, and so that self-hosted users hit a working CLI on their
  first try.

  Pairs with:
    - specs/ai-governance/cli-wrappers/wrap-login-routing.feature  (auto-login on wrap)
    - specs/ai-governance/cli-wrappers/request-increase.feature    (budget-increase flow)
    - .monitor-logs/lane-s-cli-login-audit.md                      (industry scan + decisions)
    - .monitor-logs/lane-a-persona-home-content-proposal.md        (related persona-home work)

  Background:
    Given the user has the `langwatch` CLI installed (via `npm i -g langwatch` or `npx langwatch`)
    And the user is in a terminal session with no existing GovernanceConfig
      and no `LANGWATCH_API_KEY` in their `.env`
    And `LANGWATCH_ENDPOINT` is unset in the environment

  # ─────────────────────────────────────────────────────────────────────
  # Endpoint resolution — single 4-source resolver
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli @endpoint @resolver
  Scenario: `--endpoint` flag wins over env var
    Given `LANGWATCH_ENDPOINT=https://env.example.com` is exported
    And the persisted config has `control_plane_url = https://config.example.com`
    When the user runs `langwatch login --endpoint https://flag.example.com --device`
    Then the device-flow targets `https://flag.example.com`
    And on completion the persisted config records `control_plane_url = https://flag.example.com`

  @bdd @cli @endpoint @resolver
  Scenario: env var wins over persisted config when no flag is passed
    Given `LANGWATCH_ENDPOINT=https://env.example.com` is exported
    And the persisted config has `control_plane_url = https://config.example.com`
    When the user runs any CLI command that needs the control plane
      (e.g. `langwatch whoami`, `langwatch status`, `langwatch claude`)
    Then the resolved endpoint is `https://env.example.com`
    And NOT `https://config.example.com`

  @bdd @cli @endpoint @resolver
  Scenario: persisted config wins over default when no flag and no env
    Given `LANGWATCH_ENDPOINT` is unset
    And the persisted config has `control_plane_url = https://config.example.com`
    When the user runs any CLI command that needs the control plane
    Then the resolved endpoint is `https://config.example.com`
    And NOT the hardcoded default `https://app.langwatch.ai`

  @bdd @cli @endpoint @resolver
  Scenario: hardcoded default is the last fallback
    Given no flag, no env, no persisted config
    When the user runs any CLI command that needs the control plane
    Then the resolved endpoint is `https://app.langwatch.ai`

  @bdd @cli @endpoint @resolver @regression
  Scenario: every CLI command resolves the endpoint via the same single function
    Given the codebase ships exactly ONE function `resolveControlPlaneEndpoint(opts: { flag?: string })`
      that implements the 4-source priority order
    When grepping for `LANGWATCH_ENDPOINT` env reads outside that function
    Then no other read-site exists (drift regression)
    And the previously-drifted callers (`status.ts`, `endpoint.ts:getEndpoint`,
      `governance/config.ts:defaults`) all delegate to the single resolver

  @bdd @cli @endpoint @cleanup
  Scenario: undocumented `LANGWATCH_URL` legacy alias is dropped — `LANGWATCH_ENDPOINT` is the only env name
    Given the codebase previously had ONE site
      (`typescript-sdk/src/cli/utils/governance/config.ts:defaults`)
      that read `LANGWATCH_URL` as a fallback for `LANGWATCH_ENDPOINT`
    And the alias was never documented in README, .env.example, docs, or CLI --help
    When grepping for `LANGWATCH_URL` across the codebase
    Then there are zero references (the alias is removed entirely, no compat shim)
    And `LANGWATCH_ENDPOINT` is the single canonical env name
    And the cleanup is documented in CHANGELOG.md as a non-breaking change
      (the alias was undocumented, so removal does not break any documented contract)

  # ─────────────────────────────────────────────────────────────────────
  # `langwatch config` — explicit persistence command
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli @config @set
  Scenario: `langwatch config set endpoint` persists to the user-global config
    Given no persisted config exists
    When the user runs `langwatch config set endpoint https://lw.acme.internal`
    Then `~/.langwatch/config.json` is created with `control_plane_url = https://lw.acme.internal`
    And subsequent CLI invocations resolve the endpoint to `https://lw.acme.internal`
      (without an explicit flag or env var)

  @bdd @cli @config @set @validation
  Scenario: `langwatch config set endpoint` rejects malformed URLs
    When the user runs `langwatch config set endpoint not-a-url`
    Then the command exits 1 with stderr "endpoint must be an absolute URL with http(s) scheme"
    And the persisted config is NOT touched

  @bdd @cli @config @get
  Scenario: `langwatch config get` reads a single value
    Given the persisted config has `control_plane_url = https://lw.acme.internal`
    When the user runs `langwatch config get endpoint`
    Then stdout is exactly `https://lw.acme.internal\n`

  @bdd @cli @config @list
  Scenario: `langwatch config list` shows current resolved values + their sources
    Given `LANGWATCH_ENDPOINT=https://env.example.com` is exported
    And the persisted config has `control_plane_url = https://config.example.com`
    When the user runs `langwatch config list`
    Then stdout includes `endpoint = https://env.example.com  (from LANGWATCH_ENDPOINT env)`
    And stdout includes a "config file: ~/.langwatch/config.json" footer
    And stdout includes `gateway_url = …` (current gateway URL + source)
    And no secret values (access_token, refresh_token, vk secret) are printed

  # ─────────────────────────────────────────────────────────────────────
  # `langwatch login` — unified interactive default
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli @login @interactive @gh-style @agent-aware
  Scenario: `langwatch login` (no flags, TTY) prompts for endpoint + auth mode with always-on agent-hint banner
    Given the user is in an interactive terminal (`process.stdin.isTTY === true`)
    When the user runs `langwatch login` with no flags
    Then the CLI renders a top banner BEFORE the first prompt — always visible,
      not optional:
      "Running interactively. For agents/CI, skip the prompts by passing:
         --device         AI tools / SSO (recommended)
         --api-key <K>    project SDK key (writes .env)
         --token <T>      pre-minted device session
         --endpoint <U>   self-hosted instance URL"
    And the CLI prompts:
      "Where do you want to log in?
        1) LangWatch Cloud (app.langwatch.ai)
        2) Self-hosted instance (custom URL)"
    And on selecting (2) the CLI prompts for the URL and validates http(s) scheme
    And the CLI then prompts:
      "How do you want to use it?
        1) AI tools / agentic flows  (claude, codex, cursor, gemini, opencode) — device-flow SSO
        2) Project / SDK API key     (langwatch sync, langwatch eval, …)        — API key into .env
        3) Both"
    And on selecting (1) it runs the device-flow → `~/.langwatch/config.json`
    And on selecting (2) it runs the legacy API-key paste flow → `$CWD/.env`
    And on selecting (3) it runs both flows in sequence

  @bdd @cli @login @agent-aware @fake-tty
  Scenario: agent-hint banner is shown EVEN when stdin reports as TTY (fake-TTY agents)
    Given the agent harness exposes a fake PTY where `process.stdin.isTTY === true`
      but no human is present at the keyboard
    When the agent invokes `langwatch login` with no flags expecting non-blocking behavior
    Then the agent-hint banner is the FIRST output stream the agent sees
    And the banner explicitly names `--device`, `--api-key`, `--token`, `--endpoint`
      so the agent can self-correct by re-invoking with the right flag
    And the human-facing prompt is rendered AFTER the banner so a real human still
      sees it correctly

  @bdd @cli @login @non-tty
  Scenario: `langwatch login` (no flags, NON-TTY) errors with an actionable hint
    Given the user is in a non-interactive context (CI, agent stdin, piped)
    When the user runs `langwatch login` with no flags
    Then the CLI exits 1 with stderr:
      "Cannot run interactive login in a non-TTY context.
       Run one of:
         langwatch login --device                    # device-flow (recommended for AI tools)
         langwatch login --api-key <KEY>             # project SDK key (writes .env)
         langwatch login --token <TOKEN>             # pre-minted device session (CI)
         LANGWATCH_AUTO_LOGIN=1 langwatch <wrapper>  # let the wrapper trigger it"

  @bdd @cli @login @endpoint
  Scenario: `langwatch login --endpoint <url>` skips the cloud-vs-self-hosted prompt
    Given the user is in an interactive terminal
    When the user runs `langwatch login --endpoint https://lw.acme.internal`
    Then the CLI does NOT prompt "Where do you want to log in?"
    And the auth-mode prompt still fires (device vs api-key vs both)
    And the resolved endpoint for both flows is `https://lw.acme.internal`
    And the persisted config (and/or .env) records the endpoint after success

  @bdd @cli @login @device-skip
  Scenario: `langwatch login --device` skips both prompts (existing behavior preserved)
    Given the user is in an interactive terminal
    When the user runs `langwatch login --device`
    Then the CLI runs the device-flow directly with no prompts
    And the endpoint resolves via the 4-source resolver (default → app.langwatch.ai)
    And persistence behavior matches the existing `--device` flow

  @bdd @cli @login @api-key-skip
  Scenario: `langwatch login --api-key <key>` skips both prompts (existing behavior preserved)
    When the user runs `langwatch login --api-key sk_test_xxx`
    Then the CLI writes `LANGWATCH_API_KEY=sk_test_xxx` to `$CWD/.env`
    And no interactive prompt fires
    And no device flow runs

  # ─────────────────────────────────────────────────────────────────────
  # No-paste convergence — both modes mint via device-code-poll
  # (sergey f9fcc3927 backend + alexis bfef4ebab project-picker)
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli @login @no-paste @api-key
  Scenario: Interactive login (project mode) mints API key via device-code-poll, no copy-paste
    Given the user is in an interactive terminal and selected
      "Project / SDK API key" in the unified prompt
    When the CLI calls `POST /api/auth/cli/device-code` with body
      `{ credential_type: "project_api_key" }`
    And the user clicks "Generate API key" on the /cli/auth page
      after picking a project
    Then the server records the picked `project_id` on the device-code
      record + stamps the freshly-minted `Project.apiKey`
    And the CLI's `POST /api/auth/cli/exchange` poll returns:
      | field    | value                                              |
      | kind     | "api_key"                                          |
      | api_key  | the project's apiKey verbatim (sk-lw-…)            |
      | project  | { id, slug, name } of the picked project           |
    And the CLI writes `LANGWATCH_API_KEY=<api_key>` to `$CWD/.env`
    And the CLI writes `LANGWATCH_ENDPOINT=<endpoint>` to `$CWD/.env`
      when the response includes a non-default endpoint
    And the user is NEVER prompted to copy + paste the key

  @bdd @cli @login @no-paste @device-session
  Scenario: Interactive login (AI tools mode) mints device session, no copy-paste
    Given the user is in an interactive terminal and selected
      "AI tools / agentic flows" in the unified prompt
    When the CLI calls `POST /api/auth/cli/device-code` with body
      `{ credential_type: "device_session" }`
    And the user clicks "Approve" on the /cli/auth page
    Then the CLI's `POST /api/auth/cli/exchange` poll returns:
      | field         | value                                       |
      | kind          | "device_session"                            |
      | access_token  | OAuth bearer                                |
      | refresh_token | refresh token                               |
      | user / org    | identity payload                            |
    And the CLI persists the session to `~/.langwatch/config.json`
    And the user is NEVER prompted to copy + paste anything

  @bdd @cli @login @back-compat
  Scenario: Older servers without `kind` field still work (back-compat)
    Given the user runs `langwatch login --device` against a pre-f9fcc3927 server
    When the server's `POST /api/auth/cli/exchange` response omits `kind`
    Then the CLI normalises the response to `{ kind: "device_session", ... }`
      so callers can always switch on the discriminated union
    And the persistence path is unchanged from prior versions

  @bdd @cli @login @token
  Scenario: `langwatch login --token <token>` non-interactively imports a pre-minted device session
    Given the user has minted an access token in the dashboard "Personal Access Tokens" surface
    When the user runs `langwatch login --token <opaque-token>`
    Then the token is written to `~/.langwatch/config.json:access_token`
    And no browser opens
    And no prompt fires
    And subsequent `langwatch claude` etc. uses that token to mint a personal VK

  @bdd @cli @login @combinable-flags
  Scenario: `--endpoint` + `--device` combine cleanly
    When the user runs `langwatch login --endpoint https://lw.acme.internal --device`
    Then the device-flow targets `https://lw.acme.internal`
    And `~/.langwatch/config.json:control_plane_url` is `https://lw.acme.internal`
    And no prompts fire (both axes have explicit values)

  # ─────────────────────────────────────────────────────────────────────
  # Storage discipline — project vs user-global is honest
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli @storage
  Scenario: API-key flow writes ONLY to project `.env`, not to user-global config
    When the user runs `langwatch login --api-key sk_test_xxx`
    Then `$CWD/.env` contains `LANGWATCH_API_KEY=sk_test_xxx`
    And `~/.langwatch/config.json` is NOT modified or created
    And `~/.langwatch/config.json` access_token (if previously set) is NOT touched

  @bdd @cli @storage
  Scenario: device-flow writes ONLY to user-global config, not to project `.env`
    When the user runs `langwatch login --device` and completes the flow
    Then `~/.langwatch/config.json` contains the access_token + refresh_token
    And `$CWD/.env` is NOT modified or created
    And the existing `LANGWATCH_API_KEY` in `.env` (if any) is NOT touched

  @bdd @cli @storage
  Scenario: both-flow runs both paths and writes to both stores
    Given the user picks "Both" in the unified-interactive flow
    When both flows complete successfully
    Then `~/.langwatch/config.json` contains the device-session
    And `$CWD/.env` contains the project API key
    And neither store leaks into the other

  # ─────────────────────────────────────────────────────────────────────
  # `langwatch logout` — symmetric to login (existing behavior preserved)
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli @logout @existing
  Scenario: `langwatch logout-device` clears only the user-global config
    Given the user has both a device session AND a project API key
    When the user runs `langwatch logout-device`
    Then `~/.langwatch/config.json` is removed (or access_token cleared)
    And `$CWD/.env`'s `LANGWATCH_API_KEY` is NOT touched
