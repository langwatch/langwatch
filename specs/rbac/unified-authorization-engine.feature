@unimplemented
Feature: Unified authorization engine
  As the LangWatch platform
  I need every access decision - for any principal, on any surface - to flow
  through one engine with one permission vocabulary
  So that a grant means the same thing everywhere and gaps cannot hide in
  parallel implementations

  # Proposal-stage spec for ADR-046 (unified authorization engine).
  #
  # Supersedes, upon ADR-046 acceptance, the "most specific scope wins"
  # scenarios in scoped-role-bindings.feature ("Project-level binding
  # overrides team-level binding", "More specific binding takes precedence
  # over org-level binding"): the implemented and hereby-chosen semantic is
  # an additive union of grants. Bindings only ever ADD permissions; scoping
  # someone down means granting them less, not overriding them with less.
  # See ADR-046 "Grant semantics" for why.

  Background:
    Given an organization "acme"
    And a team "client-a" in "acme" with project "chatbot"

  # ============================================================================
  # One vocabulary with resource knowledge
  # ============================================================================

  Scenario: The permission registry only admits actions a resource supports
    Given the registry declares resource "traces" with actions "view, share, create, update"
    When a custom role is saved with permission "traces:rotate"
    Then the save is rejected as an invalid permission
    And the same rejection applies on every surface that accepts permissions

  Scenario: Registry knowledge drives every projection of the vocabulary
    Given the registry declares resource "cost" as read-only with actions "view"
    When the custom-role editor, the API-key scope picker, and the docs list "cost"
    Then each offers exactly the actions the registry declares
    And no surface maintains its own list of valid actions

  Scenario: A permission can only be granted at scopes where its resource exists
    Given the registry declares resource "governance" as organization-tier only
    When a role containing "governance:manage" is bound at team scope
    Then the binding never grants "governance:manage"

  # ============================================================================
  # One decision path for every principal
  # ============================================================================

  Scenario Outline: Every principal type resolves through the same engine
    Given a principal of type <principal>
    When the platform checks a permission for it
    Then the decision comes from the unified engine
    And the decision is recorded with principal, permission, scope, and outcome

    Examples:
      | principal        |
      | user             |
      | api key          |
      | share token      |
      | demo visitor     |
      | platform ops     |

  Scenario: Grants are an additive union across scopes
    Given user "alice" has role "admin" bound at organization "acme"
    And user "alice" has role "viewer" bound at project "chatbot"
    When alice's permission "traces:update" is checked on project "chatbot"
    Then the check is granted
    # Union semantics: the viewer binding adds nothing, removes nothing.

  Scenario: Narrow access is expressed by granting less, not by overriding
    Given user "carol" has role "viewer" bound at project "chatbot"
    And user "carol" has no other bindings in "acme"
    When carol's permission "traces:update" is checked on project "chatbot"
    Then the check is denied
    And carol's permission "traces:view" is granted on project "chatbot"
    And carol has no access to any other project in "acme"

  Scenario: An API key is capped by its owner's current grants
    Given an API key owned by "dave" with role "member" bound at project "chatbot"
    And dave's own bindings in "acme" have been reduced to role "viewer"
    When the API key's permission "datasets:manage" is checked on project "chatbot"
    Then the check is denied
    # effective(key) = grants(key) ∩ grants(owner), evaluated live.

  Scenario: A share token grants exactly one permission on exactly one resource
    Given trace "t1" in project "chatbot" has a public share token
    When an anonymous visitor presents the token
    Then "traces:view" is granted for trace "t1" only
    And no other permission or resource is reachable with that token

  # ============================================================================
  # Lite member is a role, not a cross-cutting cap
  # ============================================================================

  Scenario: Lite member capability comes from the lite-member role's own grants
    Given user "sarah" holds the built-in "lite-member" role in "acme"
    When sarah's permission "annotations:create" is checked on project "chatbot"
    Then the check is granted
    And sarah's permission "datasets:manage" is denied
    # The denial reason is "lite-member-restricted" so the UI can explain it.

  Scenario: Seat classification is billing data and never consulted for access
    Given user "sarah" is classified as a lite seat for billing
    And sarah has been granted a custom role with "datasets:manage" on "chatbot"
    When sarah's permission "datasets:manage" is checked on project "chatbot"
    Then the check is granted
    And the seat classification is unchanged

  # ============================================================================
  # Fail-closed surfaces
  # ============================================================================

  Scenario: Every endpoint declares its access decision or an explicit reason not to
    When the API surface is enumerated at build time
    Then every tRPC procedure and every HTTP route either declares a permission
    Or carries an explicit no-permission marker with a written reason
    And the build fails for any endpoint that does neither

  Scenario: Legacy membership rows resolve identically to their backfilled bindings
    Given a user whose membership predates role bindings
    When any permission is checked for them before and after the backfill
    Then the decisions are identical

  # ============================================================================
  # Operating the engine (ADR-046 Part II)
  # ============================================================================

  Scenario: Any decision can be explained
    Given user "alice" is denied "datasets:delete" on project "chatbot"
    When an admin asks why
    Then the platform lists the bindings that were collected for alice
    And states why each one did not grant the permission
    And names the roles and scopes that would grant it

  Scenario: Editing a role previews its blast radius before saving
    Given custom role "SRE" is bound to 3 people across 2 projects
    When an admin removes "datasets:manage" from "SRE" in the editor
    Then the editor shows who loses which access before the change is saved

  Scenario: A publicly shared trace opens without sign-in, redacted
    Given trace "t1" in project "chatbot" is marked publicly shared
    When a visitor with no session opens the share link
    Then trace "t1" renders with the public audience's redactions applied
    And no other trace or resource in "chatbot" is reachable

  Scenario: The creator of an API key manages it without any binding
    Given user "dave" created API key "lw-sk-42"
    And dave holds no binding granting any "apiKeys" permission
    When dave views, rotates, or deletes "lw-sk-42"
    Then each action is permitted
    And another member without the cross-user audit permission cannot see it

  Scenario: A lite member's API key is capped exactly like their session
    Given user "sarah" holds the built-in "lite-member" role in "acme"
    And sarah owns an API key bound as "member" at organization "acme"
    When the key's permission "datasets:manage" is checked on project "chatbot"
    Then the check is denied

  Scenario: Revoking a binding takes effect on the caller's next request
    Given user "alice" has role "member" bound at project "chatbot"
    And alice's grants are being served from a cache
    When an admin revokes that binding
    Then alice's next permission check on "chatbot" is denied

  Scenario: Repeated checks with unchanged grants read nothing from the database
    Given alice's grants were resolved once after the latest grant change
    When the platform checks 50 permissions for alice across the same scopes
    Then no further database reads occur for those checks
    And the answers match a fresh resolution exactly

  Scenario: An impersonated request records both identities
    Given a platform admin impersonates user "customer-carol"
    When any permission is checked during that session
    Then grants resolve exactly as carol's own
    And the recorded decision names carol as the subject and the admin as the actor

  Scenario: Promotion does not grow a scoped API key
    Given user "dave" created an API key bound as "member" on project "chatbot"
    And dave is later promoted to "admin" at organization "acme"
    When the key's permission "project:delete" is checked on project "chatbot"
    Then the check is denied
    And dave's own session is granted "project:delete" on project "chatbot"

  Scenario: Offboarding a user removes every grant, with proof
    Given user "dave" holds bindings at organization, team, and project scopes in "acme"
    And dave belongs to 2 groups and owns 3 API keys
    When an admin offboards dave from "acme"
    Then dave's direct bindings and group memberships in "acme" are removed
    And credentials dave owns stop resolving any permission
    And the platform verifies dave's effective permissions in "acme" are empty
    And the offboarding report lists anything still needing a human decision
