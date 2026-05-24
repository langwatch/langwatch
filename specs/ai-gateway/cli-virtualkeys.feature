Feature: langwatch CLI — virtual-keys subcommands (multi-scope)

  # All scenarios in this file describe the `langwatch virtual-keys` CLI
  # surface as shipped by R3 (PR #3524). The CLI talks to
  # /api/gateway/v1/virtual-keys/* and matches the new multi-scope VK
  # shape (organizationId + scopes[] + routingPolicyId) from the
  # post-refactor service signatures (sergey S1, alexis A1).

  As a LangWatch user with an API token
  I want to manage AI Gateway virtual keys from the terminal
  So that I can script VK provisioning, rotation, and revocation without the UI
  (and dogfood the public REST API end-to-end in the process)

  The CLI mirrors the existing `langwatch model-providers` subcommand pattern:
  authentication via the stored personal-access token from `langwatch login`,
  output via colourful tables with `--format json` for scripts, and clear
  error messages on permission failures. All commands hit the public REST
  API at /api/gateway/v1/virtual-keys/*.

  Background:
    Given I have installed the LangWatch CLI (`npm i -g langwatch`)
    And I have run `langwatch login` with a personal-access token that has `virtualKeys:manage` at ORGANIZATION "acme"
    And organization "acme" has team "platform" with project "demo"
    And organization "acme" has a ModelProvider "openai" at ORGANIZATION scope (Advanced/Gateway: rpm=600, fallbackPriorityGlobal=10)
    And organization "acme" has a ModelProvider "anthropic" at TEAM "platform" scope (Advanced/Gateway: rpm=300, fallbackPriorityGlobal=20)

  # ============================================================================
  # list
  # ============================================================================

  @integration @cli @unimplemented
  Scenario: List virtual keys (empty)
    Given organization "acme" has no virtual keys
    When I run `langwatch virtual-keys list`
    Then the exit code is 0
    And stdout contains "No virtual keys yet"
    And stdout suggests "langwatch virtual-keys create --name <name> --scope ORG:<slug>"

  @integration @cli @unimplemented
  Scenario: List virtual keys (populated, mixed scopes)
    Given organization "acme" has VKs: `prod-key` (ORG:acme), `team-key` (TEAM:platform), `demo-key` (PROJECT:demo)
    When I run `langwatch virtual-keys list`
    Then the exit code is 0
    And stdout shows a table with columns "ID, Name, Env, Status, Prefix, Scopes, Last used"
    And the `Scopes` column renders `ORG:acme`, `TEAM:platform`, `PROJECT:demo` respectively
    And the table has 3 rows

  @integration @cli @unimplemented
  Scenario: List virtual keys as JSON
    Given organization "acme" has 2 virtual keys
    When I run `langwatch virtual-keys list --format json`
    Then the exit code is 0
    And stdout is a valid JSON array of 2 objects
    And each object has keys `id`, `name`, `prefix`, `environment`, `status`, `scopes`, `routing_policy_id`, `principal_user_id`, `organization_id`, `project_id`, `created_at`
    And the `scopes` field is an array of `{ scope_type, scope_id }` rows

  # ============================================================================
  # create
  # ============================================================================

  @integration @cli @unimplemented
  Scenario: Create a virtual key at ORG scope
    When I run `langwatch virtual-keys create --name prod-key --scope ORG:acme`
    Then the exit code is 0
    And stdout contains `Created virtual key "prod-key"`
    And stdout displays the full secret in a highlighted box
    And stdout warns that the secret will not be shown again
    And the created VK has `organization_id="acme"` and `scopes=[{ORGANIZATION, "acme"}]` and `routing_policy_id=null`
    And the VK uses the org's default RoutingPolicy ordering at dispatch time

  @integration @cli @unimplemented
  Scenario: Create a multi-scope VK across two teams
    Given my token has `virtualKeys:manage` at TEAM "platform" AND TEAM "data-sci"
    When I run `langwatch virtual-keys create --name cross-team --scope TEAM:platform --scope TEAM:data-sci`
    Then the exit code is 0
    And the created VK has `scopes=[{TEAM,"platform"},{TEAM,"data-sci"}]`
    And the eligible-MP set is the union of MPs visible from both teams (see vk-scope-inheritance.feature)

  @integration @cli @unimplemented
  Scenario: Create a project-scoped VK with a pinned RoutingPolicy
    Given a RoutingPolicy "rp_demo_priority" exists at ORG "acme" with model_provider_ids `[openai, anthropic]`
    When I run `langwatch virtual-keys create --name demo-key --scope PROJECT:demo --routing-policy rp_demo_priority`
    Then the exit code is 0
    And the created VK has `routing_policy_id="rp_demo_priority"` and `scopes=[{PROJECT,"demo"}]`

  @integration @cli @unimplemented
  Scenario: Create a personal VK (principal-attributed)
    When I run `langwatch virtual-keys create --name leos-personal --scope ORG:acme --principal-user leo@acme.test`
    Then the exit code is 0
    And the created VK has `principal_user_id="leo@acme.test"`
    And spend cascades through Leo's PRINCIPAL-scope budget first (see vk-personal-scope.feature)

  @integration @cli @unimplemented
  Scenario: Create in test mode
    When I run `langwatch virtual-keys create --name test-key --env test --scope PROJECT:demo`
    Then the created key has prefix `vk-lw-test_…`
    And the env badge in the output shows `test`

  @integration @cli @json-output @unimplemented
  Scenario: Create with JSON output for scripts
    When I run `langwatch virtual-keys create --name prod --scope ORG:acme --format json`
    Then stdout is a single-line JSON object with keys `virtual_key` and `secret`
    And `virtual_key.scopes` is `[{"scope_type":"ORGANIZATION","scope_id":"acme"}]`
    And `secret` contains the full key (only shown in this one response)

  @integration @cli @unimplemented
  Scenario: Missing --scope rejects with helpful examples
    When I run `langwatch virtual-keys create --name x`
    Then the exit code is 1
    And stderr contains `at least one --scope <TYPE:id> is required`
    And stderr shows examples: `--scope ORG:acme`, `--scope TEAM:platform`, `--scope PROJECT:demo`

  @integration @cli @unimplemented
  Scenario: Malformed scope value
    When I run `langwatch virtual-keys create --name x --scope GARBAGE`
    Then the exit code is 1
    And stderr names the parse error and shows the expected form `TYPE:id`

  @integration @cli @unimplemented
  Scenario: Unknown scope type
    When I run `langwatch virtual-keys create --name x --scope WORKSPACE:acme`
    Then the exit code is 1
    And stderr names the allowed types: `ORG | ORGANIZATION | TEAM | PROJECT`

  # ============================================================================
  # update
  # ============================================================================

  @integration @cli @unimplemented
  Scenario: Update a VK's scope set (full replacement)
    Given a VirtualKey "vk_team" scoped to TEAM "platform"
    When I run `langwatch virtual-keys update vk_team --scope TEAM:platform --scope TEAM:data-sci`
    Then the exit code is 0
    And the VK now has `scopes=[{TEAM,"platform"},{TEAM,"data-sci"}]`
    And `--scope` REPLACES the prior set (it is not additive — passing one value drops all others)

  @integration @cli @unimplemented
  Scenario: Pin a routing policy
    Given a VirtualKey "vk_org" with no routing policy
    When I run `langwatch virtual-keys update vk_org --routing-policy rp_strict`
    Then the VK now has `routing_policy_id="rp_strict"`

  @integration @cli @unimplemented
  Scenario: Unpin routing policy (fall back to org default)
    Given a VirtualKey "vk_pinned" with `routing_policy_id="rp_strict"`
    When I run `langwatch virtual-keys update vk_pinned --clear-routing-policy`
    Then the VK now has `routing_policy_id=null`
    And dispatch falls back to the org's default ordering (`fallbackPriorityGlobal` then `createdAt`)

  @integration @cli @unimplemented
  Scenario: Update with no fields rejects
    When I run `langwatch virtual-keys update vk_x`
    Then the exit code is 1
    And stderr lists every accepted flag: `--name, --description, --clear-description, --scope, --routing-policy, --clear-routing-policy, --config-json, --config-file`

  # ============================================================================
  # rotate
  # ============================================================================

  @integration @cli @unimplemented
  Scenario: Rotate a VK's secret
    Given I know the id of VK "prod-key"
    When I run `langwatch virtual-keys rotate prod-key`
    Then the exit code is 0
    And stdout asks for confirmation `Rotating will require updating clients within 24h grace. Continue? [y/N]`
    When I type "y"
    Then a new secret is displayed exactly once
    And stdout notes `Old secret valid for 24 hours`

  @integration @cli @unimplemented
  Scenario: Rotate with --yes skips confirmation
    When I run `langwatch virtual-keys rotate prod-key --yes`
    Then rotation happens without prompting

  # ============================================================================
  # revoke
  # ============================================================================

  @integration @cli @unimplemented
  Scenario: Revoke a VK
    Given I know the id of VK "stale-key"
    When I run `langwatch virtual-keys revoke stale-key`
    Then the exit code is 0
    And stdout asks for confirmation `Revoke will immediately break any client using this key. Continue? [y/N]`
    When I type "y"
    Then stdout says `Revoked. Gateway caches invalidate within 60 seconds.`

  @integration @cli @unimplemented
  Scenario: Revoke with --yes skips confirmation
    When I run `langwatch virtual-keys revoke stale-key --yes`
    Then the VK is revoked without prompting

  # ============================================================================
  # get (single key detail)
  # ============================================================================

  @integration @cli @unimplemented
  Scenario: Get a VK's config
    Given I know the id of VK "prod-key"
    When I run `langwatch virtual-keys get prod-key`
    Then stdout shows: id, name, environment, status, prefix, principal, scopes (formatted as `TYPE:id, …`), routing policy id (or `(default)`), created/last-used/revoked timestamps, view-in-UI link `/settings/gateway/virtual-keys/<id>`, and the config JSON

  # ============================================================================
  # Errors
  # ============================================================================

  @integration @cli @unimplemented
  Scenario: Missing API token
    Given I have NOT run `langwatch login`
    When I run `langwatch virtual-keys list`
    Then the exit code is 1
    And stderr contains "No LangWatch API key found"
    And stderr suggests running "langwatch login"

  @integration @cli @unimplemented
  Scenario: Token lacks permission at the requested scope
    Given my token has only `virtualKeys:view` at ORGANIZATION "acme"
    When I run `langwatch virtual-keys create --name x --scope ORG:acme`
    Then the exit code is 1
    And stderr contains `permission_denied`
    And stderr names the missing perm: `virtualKeys:manage at ORGANIZATION:acme`

  @integration @cli @unimplemented
  Scenario: Token lacks permission at one of several scopes (multi-scope intersection)
    Given my token has `virtualKeys:manage` at TEAM "platform" only
    When I run `langwatch virtual-keys create --name x --scope TEAM:platform --scope TEAM:data-sci`
    Then the exit code is 1
    And stderr names the unauthorised scope: `virtualKeys:manage at TEAM:data-sci`
    And stderr does NOT name TEAM:platform (that one is authorised)

  @integration @cli @unimplemented
  Scenario: Routing policy out of org scope
    When I run `langwatch virtual-keys create --name x --scope ORG:acme --routing-policy rp_belongs_to_other_org`
    Then the exit code is 1
    And stderr names the policy and the org it belongs to

  # ============================================================================
  # Dogfooding integration — using a VK the CLI just created
  # ============================================================================

  @integration @cli @dogfood @unimplemented
  Scenario: Minted VK immediately works against the gateway
    When I run `langwatch virtual-keys create --name dogfood --scope ORG:acme --format json`
    And I capture the `secret` field as $VK
    And I run `OPENAI_API_KEY=$VK OPENAI_BASE_URL=http://localhost:7400/v1 langwatch sdk test chat`
    Then the test call succeeds via the org's default RoutingPolicy
    And a trace appears in project "demo" (or `internal_governance` per vk-config-bundle resolution) tagged with the dogfood VK
