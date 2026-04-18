Feature: langwatch CLI — virtual-keys subcommands
  As a LangWatch user with an API token
  I want to manage AI Gateway virtual keys from the terminal
  So that I can script VK provisioning, rotation, and revocation without the UI
  (and dogfood the public REST API end-to-end in the process)

  The CLI mirrors the existing `langwatch model-providers` subcommand pattern:
  authentication via the stored personal-access token from `langwatch login`,
  output via colourful tables with `--format json` for scripts, and clear
  error messages on permission failures. All commands hit the public REST API
  at /api/gateway/v1/virtual-keys/*.

  Background:
    Given I have installed the LangWatch CLI (`npm i -g langwatch`)
    And I have run `langwatch login` with a personal-access token that has "virtualKeys:manage" on project "gateway-demo"
    And project "gateway-demo" has "openai" and "anthropic" providers configured

  # ============================================================================
  # list
  # ============================================================================

  @integration @cli
  Scenario: List virtual keys (empty)
    Given project "gateway-demo" has no virtual keys
    When I run `langwatch virtual-keys list`
    Then the exit code is 0
    And stdout contains "No virtual keys configured"
    And stdout suggests "langwatch virtual-keys create --name <name>"

  @integration @cli
  Scenario: List virtual keys (populated)
    Given project "gateway-demo" has 2 virtual keys "prod-key" and "dev-key"
    When I run `langwatch virtual-keys list`
    Then the exit code is 0
    And stdout shows a table with columns "Name, Prefix, Env, Status, Providers, Last Used, Created"
    And the table has 2 rows

  @integration @cli
  Scenario: List virtual keys as JSON
    Given project "gateway-demo" has 2 virtual keys
    When I run `langwatch virtual-keys list --format json`
    Then the exit code is 0
    And stdout is a valid JSON array of 2 objects
    And each object has keys "id", "name", "prefix", "env", "status", "providers", "created_at"

  # ============================================================================
  # create
  # ============================================================================

  @integration @cli
  Scenario: Create a virtual key with defaults
    When I run `langwatch virtual-keys create --name prod-key --provider openai`
    Then the exit code is 0
    And stdout contains "Created virtual key: lw_vk_live_01HZX..."
    And stdout displays the full secret in a highlighted box
    And stdout warns that the secret will not be shown again
    And stdout suggests "Copy now:" with the full secret

  @integration @cli
  Scenario: Create with multiple providers (fallback chain)
    When I run `langwatch virtual-keys create --name prod --provider openai --provider anthropic`
    Then the virtual key is created with providers [openai, anthropic] in that order

  @integration @cli
  Scenario: Create in test mode
    When I run `langwatch virtual-keys create --name test-key --env test --provider openai`
    Then the created key has prefix "lw_vk_test_"
    And the env badge in the output shows "test"

  @integration @cli
  Scenario: Create with a budget
    When I run `langwatch virtual-keys create --name budget-key --provider openai --budget-usd 100 --budget-window month`
    Then a VK is created
    And a monthly $100 project-scoped budget is attached with on_breach "block"

  @integration @cli @json-output
  Scenario: Create with JSON output for scripts
    When I run `langwatch virtual-keys create --name prod --provider openai --format json`
    Then stdout is a single-line JSON object with keys "id", "secret", "prefix", "env", "created_at"
    And the "secret" field contains the full key (only shown in this one response)

  # ============================================================================
  # rotate
  # ============================================================================

  @integration @cli
  Scenario: Rotate a VK's secret
    Given I know the id of VK "prod-key"
    When I run `langwatch virtual-keys rotate prod-key`
    Then the exit code is 0
    And stdout asks for confirmation "Rotating will require updating clients within 24h grace. Continue? [y/N]"
    When I type "y"
    Then a new secret is displayed exactly once
    And stdout notes "Old secret valid for 24 hours"

  @integration @cli
  Scenario: Rotate with --yes skips confirmation
    When I run `langwatch virtual-keys rotate prod-key --yes`
    Then rotation happens without prompting

  # ============================================================================
  # revoke
  # ============================================================================

  @integration @cli
  Scenario: Revoke a VK
    Given I know the id of VK "stale-key"
    When I run `langwatch virtual-keys revoke stale-key`
    Then the exit code is 0
    And stdout asks for confirmation "Revoke will immediately break any client using this key. Continue? [y/N]"
    When I type "y"
    Then stdout says "Revoked. Gateway caches invalidate within 60 seconds."

  @integration @cli
  Scenario: Revoke with --yes skips confirmation
    When I run `langwatch virtual-keys revoke stale-key --yes`
    Then the VK is revoked without prompting

  # ============================================================================
  # get (single key detail)
  # ============================================================================

  @integration @cli
  Scenario: Get a VK's config
    Given I know the id of VK "prod-key"
    When I run `langwatch virtual-keys get prod-key`
    Then stdout shows: prefix, env, status, created_at, providers (ordered), fallback conditions, model_aliases, budgets, guardrails, blocked_patterns, last_used_at, principal

  # ============================================================================
  # Errors
  # ============================================================================

  @integration @cli
  Scenario: Missing API token
    Given I have NOT run `langwatch login`
    When I run `langwatch virtual-keys list`
    Then the exit code is 1
    And stderr contains "No LangWatch API key found"
    And stderr suggests running "langwatch login"

  @integration @cli
  Scenario: Token lacks permission
    Given my token has only "virtualKeys:view"
    When I run `langwatch virtual-keys create --name x --provider openai`
    Then the exit code is 1
    And stderr contains "permission_denied" and "virtualKeys:create"

  @integration @cli
  Scenario: Provider not configured
    When I run `langwatch virtual-keys create --name x --provider cohere`
    Then the exit code is 1
    And stderr contains "Provider 'cohere' is not configured on project 'gateway-demo'"
    And stderr suggests "langwatch model-providers set cohere --enabled true --api-key <key>"

  # ============================================================================
  # Dogfooding integration — using a VK the CLI just created
  # ============================================================================

  @integration @cli @dogfood
  Scenario: Minted VK immediately works against the gateway
    When I run `langwatch virtual-keys create --name dogfood --provider openai --format json`
    And I capture the "secret" field as $VK
    And I run `OPENAI_API_KEY=$VK OPENAI_BASE_URL=http://localhost:7400/v1 langwatch sdk test chat`
    Then the test call succeeds
    And a trace appears in project "gateway-demo" tagged with the dogfood VK
