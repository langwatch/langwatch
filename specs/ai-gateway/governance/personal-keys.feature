Feature: AI Gateway Governance — Personal virtual keys
  As an enterprise developer
  I want a personal virtual key auto-issued at first login that grants me access
  to my org's approved providers, governed by my org's default routing policy
  So that any coding tool I run (Claude Code, Codex, Cursor, Gemini CLI) just works
  with my identity attached and my company's spend caps enforced

  Per gateway.md "Phase 1A":
    A personal virtual key is just a `VirtualKey` row whose `projectId` points to
    a personal project (Project.isPersonal=true, ownerUserId=user.id). The same
    schema, the same gateway code, the same trace pipeline. The "personalness"
    lives in the project, not in a polymorphic discriminator on the key.

  Personal VKs reference a `RoutingPolicy` that an org admin published once
  (e.g. "developer-default" — providers + model allowlist + strategy).
  The admin configures providers + policies; users just get keys.

  Background:
    Given organization "miro" has SAML SSO configured
    And admin "carol@miro.com" has connected providers:
      | provider  | scope        | label                 |
      | anthropic | ORGANIZATION | "Miro Anthropic Prod" |
      | openai    | ORGANIZATION | "Miro OpenAI Prod"    |
      | gemini    | ORGANIZATION | "Miro Gemini Prod"    |
    And admin "carol@miro.com" has published a default RoutingPolicy "developer-default":
      | scope | scopeId | strategy | providerCredentialIds         | modelAllowlist                                                          |
      | ORG   | miro    | priority | [anthropic, openai, gemini]   | ["claude-*", "gpt-5-mini", "gpt-5", "gemini-2.5-flash", "gemini-2.5-pro"] |
    And user "jane@miro.com" exists with role MEMBER

  # ---------------------------------------------------------------------------
  # Auto-issuance at first login
  # ---------------------------------------------------------------------------

  @bdd @personal-keys @issuance
  Scenario: Personal VK is auto-issued on first CLI login
    Given user "jane@miro.com" has never logged in via the CLI
    When she completes the device-code flow successfully
    Then the system creates exactly one personal VK for jane@miro.com in organization "miro"
    And the personal VK has:
      | field             | value                                              |
      | projectId         | jane's personal project id (isPersonal=true)       |
      | principalUserId   | "user_jane_123"                                    |
      | routingPolicyId   | the org's default "developer-default" policy id    |
      | secretPrefix      | starts with "lw_vk_live_"                          |
      | revokedAt         | null                                               |
    And the personal VK secret is returned exactly once in the device-exchange response (`default_personal_vk`)
    And subsequent logins re-use the existing personal VK rather than re-issuing

  @bdd @personal-keys @issuance
  Scenario: `virtualKey.issuePersonal` (tRPC) issues an additional personal VK for a specific provider
    Given user "jane@miro.com" already has a personal VK
    When she calls `virtualKey.issuePersonal({ label: "jane-laptop-2", provider: "anthropic" })`
    Then a new personal VK is created scoped to her personal project
    And the new VK references the org's default RoutingPolicy
    And the response is `{ secret, baseUrl, label }` returned exactly once

  @bdd @personal-keys @issuance @policy-resolution
  Scenario: When org has no default RoutingPolicy, personal-key issuance fails with a clear error
    Given organization "miro" has no RoutingPolicy with isDefault=true
    When user "jane@miro.com" tries to login via the CLI
    Then the device-exchange response status is 409
    And the response body contains `{ "error": "no_default_routing_policy", "message": "Your organization admin must publish a default routing policy before personal keys can be issued." }`
    And no personal VK is created

  # ---------------------------------------------------------------------------
  # Listing
  # ---------------------------------------------------------------------------

  @bdd @personal-keys @list
  Scenario: `virtualKey.listPersonal` returns only the caller's personal VKs in the current org
    Given user "jane@miro.com" has 2 personal VKs in organization "miro": ["jane-laptop", "jane-laptop-2"]
    And user "jane@miro.com" has 1 personal VK in another organization "personal-side-project"
    And user "ben@miro.com" has 1 personal VK in organization "miro"
    When jane calls `virtualKey.listPersonal({ organizationId: "miro" })`
    Then the response contains exactly the 2 VKs ["jane-laptop", "jane-laptop-2"]
    And no other user's VK appears
    And no other org's VK appears
    And each VK includes label, prefix, lastUsedAt, createdAt — never the secret

  # ---------------------------------------------------------------------------
  # Revocation
  # ---------------------------------------------------------------------------

  @bdd @personal-keys @revoke
  Scenario: User revokes their own personal VK
    Given user "jane@miro.com" has a personal VK with id "vk_jane_laptop"
    When she calls `virtualKey.revokePersonal({ id: "vk_jane_laptop" })`
    Then the VK row's revokedAt is set to now()
    And subsequent gateway requests using that VK secret return 401
    And the gateway's auth-cache entry for that VK is invalidated within 30 seconds

  @bdd @personal-keys @revoke @authz
  Scenario: User cannot revoke another user's personal VK
    Given user "jane@miro.com" has personal VK "vk_jane_laptop"
    And user "ben@miro.com" has personal VK "vk_ben_laptop"
    When jane calls `virtualKey.revokePersonal({ id: "vk_ben_laptop" })`
    Then the response status is 404 (not 403, to avoid leaking existence)
    And ben's VK is NOT revoked

  @bdd @personal-keys @revoke @admin-override
  Scenario: Admin can revoke any user's personal VK across the org
    Given admin "carol@miro.com" has the `virtualKey:revoke` permission at organization scope
    And user "jane@miro.com" has personal VK "vk_jane_laptop"
    When carol calls `virtualKey.revoke({ id: "vk_jane_laptop" })`
    Then the VK row's revokedAt is set to now()
    And the auth-cache entry is invalidated within 30 seconds
    And an audit log row is written with action "gateway.virtual_key.revoked"

  @bdd @personal-keys @revoke @user-deactivation
  Scenario: When admin deactivates a user, all their personal VKs are auto-revoked
    Given user "jane@miro.com" has 3 personal VKs across organization "miro"
    When admin "carol@miro.com" deactivates user jane@miro.com (or SCIM provisioner removes her)
    Then all 3 of jane's personal VKs have revokedAt set to now() in the same transaction
    And the gateway's auth-cache entries for those VKs are invalidated within 60 seconds

  # ---------------------------------------------------------------------------
  # Gateway resolution semantics
  # ---------------------------------------------------------------------------

  @bdd @personal-keys @gateway-resolution
  Scenario: Gateway resolves a personal VK and stamps trace attribution
    Given user "jane@miro.com" has a personal VK with secret "lw_vk_live_<...>"
    And jane's CLI is running `langwatch claude` which sends ANTHROPIC_AUTH_TOKEN=lw_vk_live_<...>
    When the gateway receives a `POST /v1/messages` with that bearer token
    Then the gateway resolves the VK with these JWT claims:
      | claim                | value                          |
      | organization_id      | "miro"                         |
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
    Given a personal VK exists for jane@miro.com
    And a project VK exists for project "miro/sales-eng/30-agent-sales-system"
    When the schema of both rows is compared
    Then both have identical column names and types
    And the only field that differs in semantics is whether `Project.isPersonal=true` for the personal one
    And both flow through the same gateway resolve-key code path
