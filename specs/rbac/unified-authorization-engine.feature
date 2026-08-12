Feature: Unified authorization engine
  As the LangWatch platform
  I need every access decision - for any principal, on any surface - to flow
  through one engine with one permission vocabulary
  So that a grant means the same thing everywhere and gaps cannot hide in
  parallel implementations

  # Spec for ADR-092 (unified authorization engine). Scenarios the engine
  # already answers are tagged @unit and bound; surfaces and stages that have
  # not shipped yet carry @unimplemented individually.
  #
  # Supersedes, upon ADR-092 acceptance, the "most specific scope wins"
  # scenarios in scoped-role-bindings.feature ("Project-level binding
  # overrides team-level binding", "More specific binding takes precedence
  # over org-level binding"): the implemented and hereby-chosen semantic is
  # an additive union of grants. Bindings only ever ADD permissions; scoping
  # someone down means granting them less, not overriding them with less.
  # See ADR-092 "Grant semantics" for why.

  Background:
    Given an organization "acme"
    And a team "client-a" in "acme" with project "chatbot"

  # ============================================================================
  # One vocabulary with resource knowledge
  # ============================================================================

  @unimplemented
  Scenario: The permission registry only admits actions a resource supports
    Given the registry declares resource "traces" with actions "view, share, create, update"
    When a custom role is saved with permission "traces:rotate"
    Then the save is rejected as an invalid permission
    And the same rejection applies on every surface that accepts permissions

  @unimplemented
  Scenario: Registry knowledge drives every projection of the vocabulary
    Given the registry declares resource "cost" as read-only with actions "view"
    When the custom-role editor, the API-key scope picker, and the docs list "cost"
    Then each offers exactly the actions the registry declares
    And no surface maintains its own list of valid actions

  @unit
  Scenario: A permission can only be granted at scopes where its resource exists
    Given the registry declares resource "governance" as organization-tier only
    When a role containing "governance:manage" is bound at team scope
    Then the binding never grants "governance:manage"

  # ============================================================================
  # One decision path for every principal
  # ============================================================================

  @unimplemented
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

  @unit
  Scenario: Grants are an additive union across scopes
    Given user "alice" has role "admin" bound at organization "acme"
    And user "alice" has role "viewer" bound at project "chatbot"
    When alice's permission "traces:update" is checked on project "chatbot"
    Then the check is granted
    # Union semantics: the viewer binding adds nothing, removes nothing.

  @unit
  Scenario: Narrow access is expressed by granting less, not by overriding
    Given user "carol" has role "viewer" bound at project "chatbot"
    And user "carol" has no other bindings in "acme"
    When carol's permission "traces:update" is checked on project "chatbot"
    Then the check is denied
    And carol's permission "traces:view" is granted on project "chatbot"
    And carol has no access to any other project in "acme"

  @unit
  Scenario: An API key is capped by its owner's current grants
    Given an API key owned by "dave" with role "member" bound at project "chatbot"
    And dave's own bindings in "acme" have been reduced to role "viewer"
    When the API key's permission "datasets:manage" is checked on project "chatbot"
    Then the check is denied
    # effective(key) = grants(key) ∩ grants(owner), evaluated live.

  @unit
  Scenario: A share token grants exactly one permission on exactly one resource
    Given trace "t1" in project "chatbot" has a public share token
    When an anonymous visitor presents the token
    Then "traces:view" is granted for trace "t1" only
    And no other permission or resource is reachable with that token

  @unit
  Scenario: The demo project opens for signed-in callers only
    Given a demo project is configured
    When a signed-in caller with no other grants views it
    Then the demo read-only set is granted
    And a caller with no session is denied
    # Legacy only ever reaches the demo check behind a session; the engine
    # keeps that line, so anonymous callers resolve through shares alone.

  # ============================================================================
  # Lite member is a role, not a cross-cutting cap
  # ============================================================================

  @unit
  Scenario: Lite member capability comes from the lite-member role's own grants
    Given user "sarah" holds the built-in "lite-member" role in "acme"
    When sarah's permission "annotations:create" is checked on project "chatbot"
    Then the check is granted
    And sarah's permission "datasets:manage" is denied
    # The denial reason is "lite-member-restricted" so the UI can explain it.

  # Unit-unprovable today: CollectedGrants has no seat field to hold constant,
  # because seat classification lives in billing tables the engine never
  # reads. Stage C separates the concepts; the proving test is an integration
  # test over billing + authz together.
  @unimplemented
  Scenario: Seat classification is billing data and never consulted for access
    Given user "sarah" is classified as a lite seat for billing
    And sarah has been granted a custom role with "datasets:manage" on "chatbot"
    When sarah's permission "datasets:manage" is checked on project "chatbot"
    Then the check is granted
    And the seat classification is unchanged

  # ============================================================================
  # Fail-closed surfaces
  # ============================================================================

  @unimplemented
  Scenario: Every endpoint declares its access decision or an explicit reason not to
    When the API surface is enumerated at build time
    Then every tRPC procedure and every HTTP route either declares a permission
    Or carries an explicit no-permission marker with a written reason
    And the build fails for any endpoint that does neither

  @unimplemented
  Scenario: Legacy membership rows resolve identically to their backfilled bindings
    Given a user whose membership predates role bindings
    When any permission is checked for them before and after the backfill
    Then the decisions are identical

  # ============================================================================
  # Setting grants (ADR-092 §11) - the write surface fails closed too
  # ============================================================================

  @unit
  Scenario: Attaching a duplicate role binding is rejected with a named error
    Given user "dave" has role "member" bound at team "client-a"
    When an admin attaches role "member" to dave at team "client-a" again
    Then the attach is rejected as already granted
    And the caller is told to update or revoke the existing binding

  @unit
  Scenario: A role binding can never reference another organization's custom role
    Given organization "rival" has a custom role "Their SRE"
    When an admin binds or re-points a binding in "acme" to "Their SRE"
    Then the write is rejected
    # Tenancy holds on create AND update - a role definition another
    # organization controls must never decide access in this one.

  @unit
  Scenario: Replacing a grant is one atomic swap
    Given user "dave" has role "member" bound at organization "acme"
    When an admin narrows dave's grant to team "client-a"
    Then the broad binding is gone and the narrow binding exists
    And the swap succeeds or fails as one unit, recorded as one audit event

  @unit
  Scenario: Resource-tier access is granted by sharing, never by a role binding
    When an admin tries to bind a role directly on trace "t1"
    Then the write is rejected
    And the rejection points at sharing as the way to grant resource access

  # ============================================================================
  # Operating the engine (ADR-092 Part II)
  # ============================================================================

  @unimplemented
  Scenario: Any decision can be explained
    Given user "alice" is denied "datasets:delete" on project "chatbot"
    When an admin asks why
    Then the platform lists the bindings that were collected for alice
    And states why each one did not grant the permission
    And names the roles and scopes that would grant it

  @unimplemented
  Scenario: Editing a role previews its blast radius before saving
    Given custom role "SRE" is bound to 3 people across 2 projects
    When an admin removes "datasets:manage" from "SRE" in the editor
    Then the editor shows who loses which access before the change is saved

  @unimplemented
  Scenario: A publicly shared trace opens without sign-in, redacted
    Given trace "t1" in project "chatbot" is marked publicly shared
    When a visitor with no session opens the share link
    Then trace "t1" renders with the public audience's redactions applied
    And no other trace or resource in "chatbot" is reachable

  @unimplemented
  Scenario: The creator of an API key manages it without any binding
    Given user "dave" created API key "lw-sk-42"
    And dave holds no binding granting any "apiKeys" permission
    When dave views, rotates, or deletes "lw-sk-42"
    Then each action is permitted
    And another member without the cross-user audit permission cannot see it

  @unit
  Scenario: A lite member's API key is capped exactly like their session
    Given user "sarah" holds the built-in "lite-member" role in "acme"
    And sarah owns an API key bound as "member" at organization "acme"
    When the key's permission "datasets:manage" is checked on project "chatbot"
    Then the check is denied

  @unit
  Scenario: Revoking a binding takes effect on the caller's next request
    Given user "alice" has role "member" bound at project "chatbot"
    And alice's grants are being served from a cache
    When an admin revokes that binding
    Then alice's next permission check on "chatbot" is denied

  @unit
  Scenario: Repeated checks with unchanged grants read nothing from the database
    Given alice's grants were resolved once after the latest grant change
    When the platform checks 50 permissions for alice across the same scopes
    Then no further database reads occur for those checks
    And the answers match a fresh resolution exactly

  @unimplemented
  Scenario: An impersonated request records both identities
    Given a platform admin impersonates user "customer-carol"
    When any permission is checked during that session
    Then grants resolve exactly as carol's own
    And the recorded decision names carol as the subject and the admin as the actor

  @unit
  Scenario: Promotion does not grow a scoped API key
    Given user "dave" created an API key bound as "member" on project "chatbot"
    And dave is later promoted to "admin" at organization "acme"
    When the key's permission "project:delete" is checked on project "chatbot"
    Then the check is denied
    And dave's own session is granted "project:delete" on project "chatbot"

  # ============================================================================
  # The resource tier (ADR-092 §8) — sharing is a grant on the tree
  # ============================================================================

  # Needs the first child-read consumer (a span/log read that authorizes AT
  # its trace's node) - no such call site exists yet, so a unit binding here
  # would assert the parent grant and call it child coverage.
  @unimplemented
  Scenario: Sharing a trace covers its children without extra grants
    Given trace "t1" in project "chatbot" is shared with anyone via a share link
    When a visitor presenting the link reads t1's spans, logs, and metrics
    Then every read is granted through trace "t1"'s single grant
    And a span belonging to a different trace in "chatbot" is not readable

  @unit
  Scenario: A share link that is not presented grants nothing
    Given trace "t1" in project "chatbot" is shared with anyone via a share link
    When a visitor requests trace "t1" without presenting the link
    Then the request is denied
    # Possession, not row existence, activates the grant (ADR-057's
    # trace-id-guessing hole stays closed).

  @unit
  Scenario: Expired and view-exhausted share links grant nothing
    Given trace "t1" has a share link that is expired or out of views
    When a visitor presents that link
    Then the request is denied

  @unit
  Scenario Outline: A resource grant can name any audience
    Given trace "t1" has a resource grant for <audience> with "traces:view"
    When <caller> requests trace "t1"
    Then the request is <outcome>

    Examples:
      | audience                 | caller                      | outcome |
      | user "dave"              | dave                        | granted |
      | user "dave"              | another signed-in member    | denied  |
      | members of team client-a | a member of team "client-a" | granted |
      | members of team client-a | a member of team "client-b" | denied  |
      | members of org acme      | any member of "acme"        | granted |
      | anyone                   | a visitor presenting the link | granted |

  @unit
  Scenario: Resource grants are anchored to their project
    Given trace "t1" in project "chatbot" is shared with anyone via a share link
    And a trace with the same id exists in another project
    When a visitor presenting the link requests the other project's trace
    Then the request is denied

  @unit
  Scenario: A shared thread covers its traces and their children
    Given thread "th1" in project "chatbot" is shared with anyone via a share link
    When a visitor presenting the link reads a trace inside "th1" and that trace's spans
    Then every read is granted through thread "th1"'s single grant

  @unit
  Scenario: Offboarding a user removes every grant, with proof
    Given user "dave" holds bindings at organization, team, and project scopes in "acme"
    And dave belongs to 2 groups and owns 3 API keys
    When an admin offboards dave from "acme"
    Then dave's direct bindings and group memberships in "acme" are removed
    And credentials dave owns stop resolving any permission
    And the platform verifies dave's effective permissions in "acme" are empty
    And the offboarding report lists anything still needing a human decision
