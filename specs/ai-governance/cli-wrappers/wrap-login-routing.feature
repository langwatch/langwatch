Feature: CLI wrapper login → token → env injection → routing
  As a developer using `langwatch claude` / `codex` / `cursor` / `gemini` / `opencode`
  I want my local CLI to authenticate once via device-flow, store a personal
  Virtual Key, and transparently route every wrapped tool's traffic through
  the LangWatch AI Gateway with my org's policies/budget applied
  So that I get the familiar UX of running `claude`/`codex`/etc. directly,
  but every prompt is observable + governed without any per-invocation auth.

  Inspired by `gh auth login` / `aws-vault exec` — wrap don't replace.
  Spec maps to Phase 11 (Sergey: P11-wrapper-e2e).

  Background:
    Given the user has run `langwatch login --device` and a `GovernanceConfig` with
      | field                         | value                          |
      | gateway_url                   | http://gw.test                 |
      | control_plane_url             | http://app.test                |
      | default_personal_vk.secret    | lw_vk_test_xyz                 |
    is persisted at `LANGWATCH_CONFIG_DIR`
    And the underlying tool binaries (`claude`, `codex`, `opencode`, etc.) are
      installed as executables on PATH that read their standard provider env vars

  # ─────────────────────────────────────────────────────────────────────
  # Login ceremony — device flow writes a config the wrapper can use
  # ─────────────────────────────────────────────────────────────────────
  Scenario: Login ceremony writes a usable GovernanceConfig
    Given the user has NOT logged in yet
    When the user runs `langwatch login --device` and completes the device-flow
      against a control-plane that returns a personal VK
    Then `GovernanceConfig` is persisted with `default_personal_vk.secret` set
    And the config file is readable by the wrapper on next invocation
    And `isLoggedIn(cfg)` returns true

  Scenario: Wrap fails fast when not logged in
    Given the user has NOT logged in (no config file or empty config)
    When the user runs `langwatch claude`
    Then the wrapper exits with code 1
    And stderr contains "Not logged in — run `langwatch login --device` first"
    And no child process is spawned

  # ─────────────────────────────────────────────────────────────────────
  # Env injection — per-tool standard provider env vars
  # ─────────────────────────────────────────────────────────────────────
  Scenario Outline: Wrap injects the right env vars for each tool
    Given the user is logged in with `gateway_url = http://gw.test` and a personal VK `lw_vk_test_xyz`
    When the user runs `langwatch <tool>`
    Then a child process is spawned for `<tool>` with stdio inherited
    And the child's environment contains every var in `<expected_env_vars>` set to the values listed
    And the child's environment does NOT contain provider env vars for unrelated providers

    Examples:
      | tool      | expected_env_vars                                                                                                                                            |
      | claude    | ANTHROPIC_BASE_URL=http://gw.test/api/v1/anthropic; ANTHROPIC_AUTH_TOKEN=lw_vk_test_xyz                                                                       |
      | codex     | OPENAI_BASE_URL=http://gw.test/api/v1/openai; OPENAI_API_KEY=lw_vk_test_xyz                                                                                  |
      | cursor    | OPENAI_BASE_URL=http://gw.test/api/v1/openai; OPENAI_API_KEY=lw_vk_test_xyz; ANTHROPIC_BASE_URL=http://gw.test/api/v1/anthropic; ANTHROPIC_AUTH_TOKEN=lw_vk_test_xyz |
      | gemini    | GOOGLE_GENAI_API_BASE=http://gw.test/api/v1/gemini; GEMINI_API_KEY=lw_vk_test_xyz                                                                            |
      | opencode  | OPENAI_BASE_URL=http://gw.test/api/v1/openai; OPENAI_API_KEY=lw_vk_test_xyz; ANTHROPIC_BASE_URL=http://gw.test/api/v1/anthropic; ANTHROPIC_AUTH_TOKEN=lw_vk_test_xyz |

  Scenario: Trailing slash on gateway_url is stripped before composing base URLs
    Given the user is logged in with `gateway_url = http://gw.test/`
    When the user runs `langwatch claude`
    Then the child env's ANTHROPIC_BASE_URL is "http://gw.test/api/v1/anthropic"
    And the path is NOT "http://gw.test//api/v1/anthropic" (no double slash)

  Scenario: Unknown tool exits with empty env
    Given the user is logged in
    When the user runs `langwatch nonsense-tool`
    Then `envForTool(cfg, "nonsense-tool")` returns `{ vars: {} }`
    And no provider env vars are injected into any child process

  # ─────────────────────────────────────────────────────────────────────
  # Routing — wrapped tool's HTTP traffic lands at the gateway with the VK
  # ─────────────────────────────────────────────────────────────────────
  Scenario: Wrapped claude routes Anthropic requests to the gateway with the VK
    Given a fake gateway recording inbound requests at `http://gw.test/api/v1/anthropic`
    And the user is logged in with VK `lw_vk_test_xyz`
    When the user runs `langwatch claude` and the underlying claude binary
      issues a POST to `${ANTHROPIC_BASE_URL}/v1/messages` with header
      `Authorization: Bearer ${ANTHROPIC_AUTH_TOKEN}`
    Then the fake gateway records exactly one request to path `/api/v1/anthropic/v1/messages`
    And the recorded request's Authorization header is "Bearer lw_vk_test_xyz"

  Scenario: Wrapped codex routes OpenAI requests to the gateway with the VK
    Given a fake gateway recording inbound requests at `http://gw.test/api/v1/openai`
    And the user is logged in with VK `lw_vk_test_xyz`
    When the user runs `langwatch codex` and the underlying codex binary
      issues a POST to `${OPENAI_BASE_URL}/v1/chat/completions` with header
      `Authorization: Bearer ${OPENAI_API_KEY}`
    Then the fake gateway records exactly one request to path `/api/v1/openai/v1/chat/completions`
    And the recorded request's Authorization header is "Bearer lw_vk_test_xyz"

  Scenario: Wrapped opencode routes via OpenAI-compatible env vars to the gateway
    Given a fake gateway recording inbound requests at `http://gw.test/api/v1/openai`
    And the user is logged in with VK `lw_vk_test_xyz`
    When the user runs `langwatch opencode` and the underlying opencode binary
      issues a POST to `${OPENAI_BASE_URL}/v1/chat/completions` with header
      `Authorization: Bearer ${OPENAI_API_KEY}`
    Then the fake gateway records exactly one request to path `/api/v1/openai/v1/chat/completions`
    And the recorded request's Authorization header is "Bearer lw_vk_test_xyz"

  # ─────────────────────────────────────────────────────────────────────
  # Budget pre-check — Screen-8 box + exit 2 BEFORE spawn
  # ─────────────────────────────────────────────────────────────────────
  Scenario: Budget pre-check blocks the wrap when over-limit
    Given the user is logged in
    And the control-plane `/api/governance/cli/budget/check` returns a `BudgetExceededResponse`
      with `request_increase_url = "http://app.test/orgs/acme/governance/personal-portal"`
    When the user runs `langwatch claude`
    Then the wrapper exits with code 2 BEFORE spawning the child
    And stderr contains the Screen-8 budget-exceeded box
    And `last_request_increase_url` in the persisted config equals the URL the control plane returned
    And the child claude binary is NEVER invoked

  Scenario: Budget pre-check allows the wrap when under-limit
    Given the user is logged in
    And the control-plane `/api/governance/cli/budget/check` returns `{ exceeded: false }`
    When the user runs `langwatch claude`
    Then the child process is spawned with the expected env injection
    And the wrapper exits with the child's exit code

  # ─────────────────────────────────────────────────────────────────────
  # Tool-not-found — clear error, not a generic exec failure
  # ─────────────────────────────────────────────────────────────────────
  Scenario: Wrapped tool not on PATH yields actionable error
    Given the user is logged in
    And the binary `claude` is NOT on PATH
    When the user runs `langwatch claude`
    Then the wrapper exits with code 127
    And stderr contains "claude not found in PATH — install it first"
    And stderr contains a docs link to the AI Gateway governance admin-setup page

  # ─────────────────────────────────────────────────────────────────────
  # Exit-code propagation — wrapper is transparent
  # ─────────────────────────────────────────────────────────────────────
  Scenario Outline: Wrapper propagates the child process exit code
    Given the user is logged in
    And the wrapped tool exits with code <child_code>
    When the user runs `langwatch <tool>`
    Then the wrapper exits with code <child_code>

    Examples:
      | tool   | child_code |
      | claude | 0          |
      | codex  | 1          |
      | claude | 42         |
