Feature: AI Gateway Governance — Admin RoutingPolicies (decoupled from VK)
  As an org admin rolling LangWatch out to my engineering teams
  I want to publish RoutingPolicies (provider order, model allowlist, strategy)
  once at org/team/project scope, then have personal and project VKs reference
  those policies — instead of every developer making a technical "fallback chain"
  decision when they create a key
  So that key issuance becomes "click a button and get a key" while the actual
  routing decisions remain in admin hands

  Per gateway.md "the conceptual reframe":
    The credential should hold identity + reference policy, not embed policy.
    `VirtualKey.routingPolicyId` references a `RoutingPolicy` row.
    Per-credential `VirtualKeyProviderCredential` rows continue to work as the
    *override* mechanism for production agents that need explicit chains.

  Background:
    Given organization "miro" exists
    And admin "carol@miro.com" has the `routingPolicy:*` permission at organization scope
    And the org has connected provider credentials:
      | id           | provider  | scope | label                 |
      | mp_anth_prod | anthropic | ORG   | "Miro Anthropic Prod" |
      | mp_oai_prod  | openai    | ORG   | "Miro OpenAI Prod"    |
      | mp_gem_prod  | gemini    | ORG   | "Miro Gemini Prod"    |
      | mp_brk_prod  | bedrock   | ORG   | "Miro Bedrock Prod"   |

  # ---------------------------------------------------------------------------
  # CRUD
  # ---------------------------------------------------------------------------

  @bdd @routing-policy @create
  Scenario: Admin creates an org-default RoutingPolicy
    When carol calls `routingPolicy.upsert` with:
      | field                  | value                                                            |
      | scope                  | ORGANIZATION                                                     |
      | scopeId                | "miro"                                                           |
      | name                   | "developer-default"                                              |
      | strategy               | "priority"                                                       |
      | providerCredentialIds  | ["mp_anth_prod", "mp_oai_prod", "mp_gem_prod"]                   |
      | modelAllowlist         | ["claude-*", "gpt-5-mini", "gpt-5", "gemini-2.5-*"]              |
      | isDefault              | true                                                             |
    Then a RoutingPolicy row is created with the above fields
    And exactly one default policy exists per (organizationId, scope, scopeId)
    And an audit log row "gateway.routing_policy.created" is written

  @bdd @routing-policy @update
  Scenario: Admin updates an existing RoutingPolicy
    Given the policy "developer-default" exists at ORG scope for "miro"
    When carol calls `routingPolicy.upsert` with the same id and a new modelAllowlist
    Then the existing row is updated (not duplicated)
    And the change is reflected in any new VK config materialised after the update
    And an audit log row "gateway.routing_policy.updated" is written
    And existing VKs that reference this policy automatically pick up the new allowlist within 30 seconds (gateway auth-cache TTL)

  @bdd @routing-policy @set-default
  Scenario: Admin can swap the default policy at org scope
    Given org "miro" has policies "developer-default" (isDefault=true) and "experimental" (isDefault=false)
    When carol calls `routingPolicy.setOrgDefault({ id: "experimental" })`
    Then "experimental" becomes isDefault=true at ORG scope for "miro"
    And "developer-default" automatically becomes isDefault=false (atomic swap in a transaction)
    And new personal VK issuances reference "experimental" going forward
    And existing personal VKs continue to reference whatever policy they were issued against (snapshot, not live ref) until re-bound

  # ---------------------------------------------------------------------------
  # Scope hierarchy
  # ---------------------------------------------------------------------------

  @bdd @routing-policy @hierarchy
  Scenario: When a user has a team-default policy and an org-default, team wins
    Given org "miro" has default policy "developer-default"
    And team "Sales Engineering" has default policy "sales-eng-stricter"
    And user "jane@miro.com" is a member of team "Sales Engineering"
    When jane completes the device-code flow
    Then her personal VK references "sales-eng-stricter", not "developer-default"
    And `user.personalContext` returns the resolved policy id

  @bdd @routing-policy @hierarchy
  Scenario: When a user is in NO team with a default policy, the org-default wins
    Given user "ben@miro.com" is in no team that has a default policy
    When ben completes the device-code flow
    Then his personal VK references the org-level "developer-default"

  @bdd @routing-policy @hierarchy
  Scenario: When neither team nor org has a default policy, personal-key issuance fails (see personal-keys.feature)
    Given org "miro" has no isDefault policy at any scope
    When ben tries to login
    Then issuance fails with `no_default_routing_policy` (cross-ref personal-keys.feature)

  # ---------------------------------------------------------------------------
  # Authorization
  # ---------------------------------------------------------------------------

  @bdd @routing-policy @authz
  Scenario: A non-admin cannot create or update RoutingPolicies
    Given user "jane@miro.com" has role MEMBER (no routingPolicy permissions)
    When she tries to call `routingPolicy.upsert(...)`
    Then the response is 403 FORBIDDEN
    And no row is created

  @bdd @routing-policy @authz
  Scenario: A team admin can publish a policy at TEAM scope only
    Given user "alex@miro.com" has the `routingPolicy:*` permission scoped to team "Sales Engineering"
    When she calls `routingPolicy.upsert` with scope=TEAM, scopeId="sales-engineering"
    Then the row is created
    But when she calls `routingPolicy.upsert` with scope=ORGANIZATION, scopeId="miro"
    Then the response is 403 FORBIDDEN

  # ---------------------------------------------------------------------------
  # Admin UI surface
  # ---------------------------------------------------------------------------

  @bdd @ui @routing-policy @admin-page
  Scenario: Admin RoutingPolicies page lists all policies grouped by scope
    Given org "miro" has 3 RoutingPolicies across ORG / TEAM / PROJECT scopes
    When carol navigates to "/settings/routing-policies"
    Then she sees a list grouped by scope: "Organization defaults", "Team defaults", "Project defaults"
    And each group can be expanded to show its policies with name, strategy, allowlist preview, providerCredential count
    And a "Set as default" button is present for non-default policies in each group
    And a "[ + New routing policy ]" CTA at the top of each group

  @bdd @ui @routing-policy @admin-drawer
  Scenario: New / edit policy opens a drawer with provider picker + allowlist editor
    When carol clicks "[ + New routing policy ]" in the Organization group
    Then a drawer opens with these fields:
      | field                | shape                                                                       |
      | Name                 | required text input                                                         |
      | Description          | optional textarea                                                           |
      | Strategy             | select: priority / cost / latency / round_robin (priority is default)       |
      | Providers            | multi-select with drag-to-reorder, populated from connected provider creds  |
      | Model allowlist      | tag input with glob support — empty allowlist means "any allowed by provider" |
      | Set as default       | checkbox                                                                    |
    And the "Providers" picker only shows providers in the current scope or above

  # ---------------------------------------------------------------------------
  # Visibility back to users
  # ---------------------------------------------------------------------------

  @bdd @ui @routing-policy @user-visibility
  Scenario: Personal Settings page shows the policy a user's keys reference
    Given jane's personal VK references the "developer-default" policy
    When she navigates to "/me/settings"
    Then a small "Routing policy" line in the Profile section reads "Routing: developer-default (managed by your org)"
    And the line links to a read-only policy preview drawer (no edit affordance)

  # ---------------------------------------------------------------------------
  # Strategy semantics (handed off to provider-routing.feature)
  # ---------------------------------------------------------------------------

  @bdd @routing-policy @cross-ref
  Scenario: Strategy field is enforced at the gateway dispatcher
    Given a RoutingPolicy with strategy="priority" and providerCredentialIds=[A, B, C]
    When the gateway resolves a VK that references this policy
    And the request `model` is supported by all three providers
    Then the dispatcher tries A first, then B, then C on retry
    # See provider-routing.feature for full cost/latency/round_robin coverage
