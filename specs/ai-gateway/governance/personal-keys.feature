Feature: AI Gateway Governance — Personal virtual keys
  As an enterprise developer
  I want a personal virtual key auto-issued at first login that grants me access
  to my org's approved providers, governed by my org's default routing policy
  So that any coding tool I run (Claude Code, Codex, Cursor, Gemini CLI) just works
  with my identity attached and my company's spend caps enforced

  A personal virtual key is a regular `VirtualKey` row with `principalUserId`
  set; the `principalUserId` column is orthogonal to scope (see
  vk-personal-scope.feature). The lazy-mint device-flow path issues the VK at
  ORGANIZATION scope by default, so any project the user is a member of can
  use it. The "personalness" is a column on the row, not a separate entity,
  and the eligible ModelProvider set is resolved through the same scope
  inheritance the rest of the system uses.

  Personal VKs reference a `RoutingPolicy` that an org admin published once
  (e.g. "developer-default" — providers + model allowlist + strategy).
  The admin configures providers + policies; users just get keys.

  Background:
    Given organization "acme" has SAML SSO configured
    And admin "carol@acme.com" has connected providers:
      | provider  | scope        | label                 |
      | anthropic | ORGANIZATION | "Acme Anthropic Prod" |
      | openai    | ORGANIZATION | "Acme OpenAI Prod"    |
      | gemini    | ORGANIZATION | "Acme Gemini Prod"    |
    And admin "carol@acme.com" has published a default RoutingPolicy "developer-default":
      | scope | scopeId | strategy | providerCredentialIds         | modelAllowlist                                                          |
      | ORG   | acme    | priority | [anthropic, openai, gemini]   | ["claude-*", "gpt-5-mini", "gpt-5", "gemini-2.5-flash", "gemini-2.5-pro"] |
    And user "jane@acme.com" exists with role MEMBER

  # ---------------------------------------------------------------------------
  # Auto-issuance at first login
  # ---------------------------------------------------------------------------

  @bdd @personal-keys @issuance
  Scenario: Personal VK is auto-issued on first CLI login
    Given user "jane@acme.com" has never logged in via the CLI
    When she completes the device-code flow successfully
    Then the system creates exactly one personal VK for jane@acme.com in organization "acme"
    And the personal VK has:
      | field             | value                                              |
      | organizationId    | "acme"                                             |
      | scopes            | [{ORGANIZATION, "acme"}]                           |
      | principalUserId   | "user_jane_123"                                    |
      | routingPolicyId   | the org's default "developer-default" policy id    |
      | secretPrefix      | starts with "vk-lw-"                               |
      | revokedAt         | null                                               |
    And the personal VK secret is returned exactly once in the device-exchange response (`default_personal_vk`)
    And subsequent logins re-use the existing personal VK rather than re-issuing

  @bdd @personal-keys @issuance
  Scenario: `virtualKey.issuePersonal` (tRPC) issues an additional personal VK for a specific provider
    Given user "jane@acme.com" already has a personal VK
    When she calls `virtualKey.issuePersonal({ label: "jane-laptop-2", provider: "anthropic" })`
    Then a new personal VK is created scoped to her personal project
    And the new VK references the org's default RoutingPolicy
    And the response is `{ secret, baseUrl, label }` returned exactly once

  @bdd @personal-keys @issuance @policy-resolution
  Scenario: When org has no default RoutingPolicy but has accessible providers, personal-key issuance succeeds with no policy bound
    Given organization "acme" has no RoutingPolicy with isDefault=true
    And at least one ModelProvider scoped at ORGANIZATION "acme" is enabled
    When user "jane@acme.com" logs in via the CLI device-flow
    Then a personal VK is minted with `routingPolicyId=null`
    And the gateway dispatch path uses scope-cascade + `fallbackPriorityGlobal` ordering to pick a provider
    # Pre-7651d2464 this failed with a generic 409 in the device approve
    # handler, blocking solo signups + any org that hadn't published a
    # default routing policy yet. 7651d2464 made the approve tolerate
    # the empty-policy state but left the wrapper bailing later. The
    # current behavior: mint succeeds, gateway dispatch falls back to
    # `fallbackPriorityGlobal` ASC + `createdAt` ASC on eligible MPs
    # (mirrors `eligibleModelProvidersForVk` when policy is null).

  @bdd @personal-keys @issuance @policy-resolution
  Scenario: When org has no AI providers at all, personal-key issuance fails with a clear error
    Given organization "acme" has no RoutingPolicy with isDefault=true
    And no ModelProvider is reachable from "jane@acme.com"'s personal team via scope cascade
    When user "jane@acme.com" tries to login via the CLI device-flow
    Then the device-exchange response status is 409
    And the response body contains `{ "error": "no_eligible_providers", "message": "Your organization has no AI providers configured. Ask an admin to add one at Settings → Model Providers." }`
    And no personal VK is created

  # Behavior is implemented end-to-end: personalVirtualKey.service.ts throws
  # RoutingPolicyHasNoProvidersError when the resolved policy has empty
  # modelProviderIds[], and personalVirtualKeys.ts router maps it to
  # UNPROCESSABLE_CONTENT (422). No service-layer integration test exists
  # yet for the empty-policy branch — pinned @unimplemented for the
  # PR #3524 sweep; backfill candidate when ee/governance test suite gets
  # its post-collapse rewrite pass.
  @bdd @personal-keys @issuance @policy-resolution @regression @unimplemented
  Scenario: When the default RoutingPolicy has zero providers, personal-key issuance fails with a clear error (validate-before-mint)
    Given organization "acme" HAS a default RoutingPolicy
    But that policy has zero ProviderCredentials in its `providerCredentialIds` chain
    When user "jane@acme.com" tries to login via the CLI device-flow
    Then the device-exchange response status is 422
    And the response body contains `{ "error": "routing_policy_has_no_providers", "message": "Your organization admin must bind at least one provider to the default routing policy before personal keys can be issued." }`
    And no personal VK is created
    # Regression-invariant: pre-637c4e137, the empty-policy mint succeeded
    # but every gateway call returned 504 provider_timeout (Ariana QA G34
    # caught the green-success-then-504 mismatch). Now validate-before-mint
    # symmetric with the no_default_routing_policy invariant above. Same
    # contract surfaces from `api.personalVirtualKeys.issuePersonal` (tRPC
    # UNPROCESSABLE_CONTENT → HTTP 422) and `POST /api/auth/cli/exchange`
    # (HTTP 422 + JSON error body) — no green-success on either path.

  @bdd @personal-keys @issuance @policy-resolution
  Scenario: Empty-policy invariant applies symmetrically to /me portal mint and CLI device-flow mint
    Given the same empty-default-policy state above
    When EITHER the /me portal calls `api.personalVirtualKeys.issuePersonal`
    OR the CLI device-flow exchange runs
    Then both surfaces return HTTP 422 with `routing_policy_has_no_providers`
    And both surfaces include the same actionable admin hint message
    And neither surface creates a personal VK

  # ---------------------------------------------------------------------------
  # Listing
  # ---------------------------------------------------------------------------

  @bdd @personal-keys @list
  Scenario: `virtualKey.listPersonal` returns only the caller's personal VKs in the current org
    Given user "jane@acme.com" has 2 personal VKs in organization "acme": ["jane-laptop", "jane-laptop-2"]
    And user "jane@acme.com" has 1 personal VK in another organization "personal-side-project"
    And user "ben@acme.com" has 1 personal VK in organization "acme"
    When jane calls `virtualKey.listPersonal({ organizationId: "acme" })`
    Then the response contains exactly the 2 VKs ["jane-laptop", "jane-laptop-2"]
    And no other user's VK appears
    And no other org's VK appears
    And each VK includes label, prefix, lastUsedAt, createdAt — never the secret

  # ---------------------------------------------------------------------------
  # Revocation
  # ---------------------------------------------------------------------------

  @bdd @personal-keys @revoke
  Scenario: User revokes their own personal VK
    Given user "jane@acme.com" has a personal VK with id "vk_jane_laptop"
    When she calls `virtualKey.revokePersonal({ id: "vk_jane_laptop" })`
    Then the VK row's revokedAt is set to now()
    And subsequent gateway requests using that VK secret return 401
    And the gateway's auth-cache entry for that VK is invalidated within 30 seconds

  @bdd @personal-keys @revoke @authz
  Scenario: User cannot revoke another user's personal VK
    Given user "jane@acme.com" has personal VK "vk_jane_laptop"
    And user "ben@acme.com" has personal VK "vk_ben_laptop"
    When jane calls `virtualKey.revokePersonal({ id: "vk_ben_laptop" })`
    Then the response status is 404 (not 403, to avoid leaking existence)
    And ben's VK is NOT revoked

  @bdd @personal-keys @revoke @admin-override
  Scenario: Admin can revoke any user's personal VK across the org
    Given admin "carol@acme.com" has the `virtualKey:revoke` permission at organization scope
    And user "jane@acme.com" has personal VK "vk_jane_laptop"
    When carol calls `virtualKey.revoke({ id: "vk_jane_laptop" })`
    Then the VK row's revokedAt is set to now()
    And the auth-cache entry is invalidated within 30 seconds
    And an audit log row is written with action "gateway.virtual_key.revoked"

  @bdd @personal-keys @revoke @user-deactivation
  Scenario: When admin deactivates a user, all their personal VKs are auto-revoked
    Given user "jane@acme.com" has 3 personal VKs across organization "acme"
    When admin "carol@acme.com" deactivates user jane@acme.com (or SCIM provisioner removes her)
    Then all 3 of jane's personal VKs have revokedAt set to now() in the same transaction
    And the gateway's auth-cache entries for those VKs are invalidated within 60 seconds

  # ---------------------------------------------------------------------------
  # Gateway resolution semantics
  # ---------------------------------------------------------------------------

  @bdd @personal-keys @gateway-resolution
  Scenario: Gateway resolves a personal VK and stamps trace attribution
    Given user "jane@acme.com" has a personal VK with secret "vk-lw-<...>"
    And jane's CLI is running `langwatch claude` which sends ANTHROPIC_AUTH_TOKEN=vk-lw-<...>
    When the gateway receives a `POST /v1/messages` with that bearer token
    Then the gateway resolves the VK with these JWT claims:
      | claim                | value                          |
      | organization_id      | "acme"                         |
      | project_id           | jane's personal project id     |
      | principal_id         | "user_jane_123"                |
      | personal             | true                           |
      | routing_policy_id    | "developer-default" policy id  |
    And the OTel span for the request carries `langwatch.user.id="user_jane_123"`
    And the OTel span carries `langwatch.virtual_key.is_personal=true`

  @bdd @personal-keys @gateway-resolution @policy-resolution
  Scenario: Personal VK with model NOT in the policy allowlist is rejected
    Given the org's default policy allowlist is ["claude-*", "gpt-5-mini"]
    When jane's CLI calls `POST /v1/messages` with `model="claude-4.5-opus"` (allowed by glob)
    Then the gateway forwards normally to Anthropic
    But when jane's CLI calls `POST /v1/chat/completions` with `model="gpt-5"` (NOT in allowlist)
    Then the gateway returns 403 with body `{ "error": "model_not_allowed", "model": "gpt-5", "allowed": ["claude-*", "gpt-5-mini"] }`

  # ---------------------------------------------------------------------------
  # Project-key parity
  # ---------------------------------------------------------------------------

  @bdd @personal-keys @project-parity
  Scenario: Personal VK row has identical schema shape to a project VK
    Given a personal VK exists for jane@acme.com
    And a project VK exists for project "acme/sales-eng/30-agent-sales-system"
    When the schema of both rows is compared
    Then both have identical column names and types
    And the only field that differs in semantics is whether `Project.isPersonal=true` for the personal one
    And both flow through the same gateway resolve-key code path
