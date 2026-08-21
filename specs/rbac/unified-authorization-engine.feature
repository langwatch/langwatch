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
  # over org-level binding", "Group binding at project scope overrides group
  # binding at team scope"): the implemented and hereby-chosen semantic is
  # an additive union of grants. Bindings only ever ADD permissions; scoping
  # someone down means granting them less, not overriding them with less.
  # See ADR-092 "Grant semantics" for why. That file's premise sentence -
  # "The most specific scope always wins" - is superseded by the same
  # decision and gets rewritten with those scenarios in the contract PR
  # (the delivery plan's PR 6, the contract), not before: until then it still describes
  # the resolver in production for not-yet-cut-over organizations.
  #
  # Also superseded: fetch-org-role-permission-resolution.feature's "Demo
  # projects are accessible without organization membership". Demo access
  # has always required a session, and "The demo project opens for
  # signed-in callers only" below is the version that holds.

  Background:
    Given an organization "acme"
    And a team "client-a" in "acme" with project "chatbot"
    And a team "client-b" in "acme"

  # ============================================================================
  # One vocabulary with resource knowledge
  # ============================================================================

  # "Rotating" a trace is not something the product does - traces are
  # written once and read. The platform's one list of what each resource
  # supports (the ADR-092 registry) is what makes that unsayable.
  @unimplemented
  Scenario: A permission naming an action its resource does not support is rejected
    Given traces cannot be rotated
    When a custom role is saved with permission "traces:rotate"
    Then the save is rejected as an invalid permission
    And the same rejection applies on every surface that accepts permissions

  # Every surface reads the same registry, so none of them can offer an
  # action the resource does not have.
  @unimplemented
  Scenario: Every surface offers the same actions for a resource
    Given cost data is read-only
    When the custom-role editor, the API-key scope picker, and the docs list "cost"
    Then each offers viewing and nothing else
    And no surface maintains its own list of valid actions

  # Two different surfaces, two facts, both true. The grants WRITE surface
  # refuses this outright: role-bindings-rest-api.feature binds
  # "org_exclusive_permission_scope" / 422 when a caller tries to bind an
  # organization-tier permission below organization scope. This scenario
  # pins what the read side does with a row that exists anyway - one
  # imported, backfilled, or written before the refusal existed. It is
  # collected and then grants nothing, so a stale row cannot escalate.
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

  # The HTTP half of this is already bound elsewhere:
  # specs/security/api-endpoint-authorization.feature covers the Hono
  # routes and their build-time enumeration. What is left unbound is the
  # tRPC stack, which has no equivalent sweep yet - stage D adds one, and
  # Gate D is the two stacks answering to the same rule with no allowlist.
  @unit
  Scenario: Every tRPC procedure declares its access decision or an explicit reason not to
    When the tRPC surface is enumerated at build time
    Then every procedure either declares a permission
    Or carries an explicit no-permission marker with a written reason
    And the build fails for any procedure that does neither

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

  # The grants ledger's instant enforcement (ADR-092 §13): after the ledger
  # append is accepted, a revocation applies the deny effect synchronously
  # on the calling path, without waiting for the queued fold. Redis never
  # gates it, so the guarantee below must hold with Redis stopped entirely.
  @integration
  Scenario: A revocation holds before the revoke call returns, with Redis stopped
    Given user "alice" has role "member" bound at project "chatbot"
    And Redis is unavailable
    And the queue infrastructure is stopped
    When an admin revokes that binding
    Then the revoke call succeeds
    And alice's grant is gone before the call returns
    And a permission check for alice on "chatbot" is denied immediately

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
  # The per-organization fork (delivery plan PR 3)
  # ============================================================================
  # The engine does not become the decider everywhere on a deploy. It becomes
  # the decider one organization at a time, after that organization's own
  # parity proof came back clean, and the switch is a fact in the ledger that
  # the running fleet picks up by itself.
  #
  # Every scenario below is built so the two resolvers CANNOT agree: the
  # access exists as a grant and as nothing else. Which answer comes back is
  # therefore proof of which resolver decided it, rather than a coincidence
  # of both saying yes.

  @unit
  Scenario: A cut-over organization is decided by the engine
    Given "acme" has been cut over to the engine
    And user "alice" holds a grant at project "chatbot" that no binding records
    When alice's permission "traces:view" is checked on project "chatbot"
    Then the check is granted on the engine's answer
    And the answer does not wait for the legacy resolver

  # The reverse-shadow comparison retired with the fork: the engine is the
  # only resolver, so there is no legacy answer left to compare against.

  @unit
  Scenario: An organization that has not cut over is unchanged
    Given "acme" has not been cut over
    When a permission check runs for a member of "acme"
    Then the legacy resolver's answer is the one returned
    And the engine still shadows that answer for comparison

  @unit
  Scenario: Rolling back returns an organization to the legacy path within the gate's cache window
    Given "acme" is being served by the engine
    When "acme" is rolled back onto the legacy path
    Then checks in "acme" stop consulting the engine within the gate's cache window
    And nothing is deployed or restarted for that to hold

  @unit
  Scenario: A cut-over organization's checks read the ledger's own head
    Given "acme" has been cut over to the engine
    When grants are collected for a member of "acme"
    Then they come from the grants the ledger itself records
    And the legacy binding tables are not read

  # ============================================================================
  # The Access surface reads the head that decides (delivery plan PR 3 follow-up)
  # ============================================================================
  # Decisions moved onto the ledger's head at cutover; this section moves what
  # people SEE. Every settings page that renders access - the bindings table,
  # a member's own breakdown, team member lists, a group's bindings, the API
  # key drawer, the role editor - lists from the same head the engine decides
  # from, per organization, behind the same gate. A page that renders one head
  # while the engine decides from the other could show access that does not
  # exist or hide access that does.
  #
  # Same proof style as the fork above: the listed access exists as a grant
  # and as nothing else (or the reverse), so which rows come back proves which
  # head served the listing rather than both happening to agree.

  @unit
  Scenario: A cut-over organization's access listings are served from the ledger's head
    Given "acme" has been cut over to the engine
    And user "alice" holds a grant at project "chatbot" that no binding row records
    When the organization's bindings are listed for the Access page
    Then alice's grant appears in the listing
    And the legacy binding tables are not read

  @unit
  Scenario: An organization that has not cut over keeps listing from the legacy tables
    Given "acme" has not been cut over
    And a grant head row exists that no legacy binding records
    When the organization's bindings are listed for the Access page
    Then the listing shows exactly the legacy binding rows
    And the grant head is not read

  @unit
  Scenario: A listing row keeps its identity across the cutover
    Given "acme" has a binding imported into the ledger
    When the organization's bindings are listed from each head
    Then both heads list the row under the same id
    # The imported grant ADOPTS the binding's row id, so a bookmarked or
    # cached row reference survives the head swap.

  @unit
  Scenario: A rolled-back organization's listings return to the legacy head within the gate's cache window
    Given "acme" is being served by the engine
    When "acme" is rolled back onto the legacy path
    Then access listings in "acme" stop reading the grant head within the gate's cache window
    And nothing is deployed or restarted for that to hold

  @unit
  Scenario: A cut-over organization's role editor lists roles from the ledger's head
    Given "acme" has been cut over to the engine
    And a custom role exists in the ledger's role head
    When the organization's roles are listed
    Then the role appears with its name, description and permissions
    And the legacy custom-role table is not read

  @unit
  Scenario: Dormant facts never appear as bindings in a listing
    Given "acme" has been cut over to the engine
    And the cutover imported lite-member, project-credential and platform facts
    When the organization's bindings are listed for the Access page
    Then none of those facts appear as binding rows
    # The listing shows what the legacy page showed: the compat head never
    # carried these facts, so a cut-over listing that surfaced them would be
    # a parity break in what people see, not extra honesty.

  # ============================================================================
  # The resource tier (ADR-092 §8) — sharing is a grant on the tree
  # ============================================================================
  #
  # Scope note: this section pins what the ENGINE decides about a resource
  # grant. It deliberately does not restate what a customer sees when they
  # open a share link - specs/traces-v2/sharing.feature owns that, including
  # "A public link resolves for an anonymous viewer" and the Rule covering
  # the redactions an anonymous viewer's payload carries. The engine
  # supplies the audience; that spec pins what the audience is shown.

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

  # Engine-level capability, not a link a customer can mint today: ADR-057's
  # ShareService only ever writes TRACE links (sharing.feature pins "A share
  # link covers the trace alone"), and thread-level links arrive with C5.
  # What is bound here is that a grant on a thread node covers the traces
  # beneath it through the parents chain, with no rows of their own.
  @unit
  Scenario: A shared thread covers the traces beneath it
    Given thread "th1" in project "chatbot" carries a resource grant of "traces:view"
    When a visitor presenting the grant reads a trace whose parent is "th1"
    Then the read is granted through thread "th1"'s single grant
    And a trace outside "th1" is not readable

  # ============================================================================
  # Collectives as principals (ADR-092 §13: facts, not inference)
  # ============================================================================

  # A team or an organization can hold a grant directly; the walk expands
  # membership at check time, so nothing is copied per member and nothing
  # needs cleaning up when membership changes.
  @unit @unimplemented
  Scenario: A grant held by a team reaches every member through membership
    Given team "client-a" itself holds role "viewer" at project "chatbot"
    And user "alice" is a member of team "client-a"
    When alice's permission "traces:view" is checked on project "chatbot"
    Then the check is granted through the team's grant
    And removing alice from the team denies her next check with no grant deleted

  # The organization-member floor - today an inference buried in the
  # resolver - becomes a stored grant held by the organization collective,
  # which an org admin can see and change like any other grant.
  @unit @unimplemented
  Scenario: The organization-member floor is itself a grant an admin can edit
    Given organization "acme" holds a floor grant of role "member" at "acme"
    And user "alice" belongs to "acme" with no other grants
    When alice's permission "datasets:manage" is checked at organization "acme"
    Then the check is granted through the floor grant
    # "datasets:manage" on purpose: it separates member from viewer. A
    # permission both roles carry (analytics:view) would answer the same
    # either way, and the scenario would pass without the floor moving.
    And an admin lowering the floor to "viewer" denies alice's next check

  @unit
  Scenario: Offboarding a user removes every grant, with proof
    Given user "dave" holds bindings at organization, team, and project scopes in "acme"
    And dave belongs to 2 groups and owns 3 API keys
    When an admin offboards dave from "acme"
    Then dave's direct bindings and group memberships in "acme" are removed
    And credentials dave owns stop resolving any permission
    And the platform verifies dave's effective permissions in "acme" are empty
    And the offboarding report lists anything still needing a human decision
