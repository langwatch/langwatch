# Trace sharing (redesign) — Gherkin Spec
# ADR: dev/docs/adr/039-token-gated-trace-sharing.md
#
# Supersedes the legacy PublicShare feature. The legacy model authorized
# anonymous reads by checking whether *a share row existed* for a given
# (projectId, resourceType, resourceId). Because trace IDs are caller-supplied
# and not secret, anyone who learned a shared trace's ID + projectId could read
# it without ever possessing the share link. The redesign moves authorization
# onto possession of a high-entropy secret token: the token IS the credential.
#
# Data model: PublicShare is renamed to ShareLink and gains: a secret `token`
# (unprefixed, high-entropy), an optional `threadId` (share a trace with its
# surrounding conversation), a `visibility` (PUBLIC | ORGANIZATION | PROJECT),
# an optional `expiresAt` (null = never), an optional `maxViews` (null =
# unlimited; 1 = single view) and a `viewCount`. Legacy rows are migrated in
# place: `token` is backfilled from the old `id`, `visibility` = PUBLIC,
# `expiresAt` = null, so every existing /share/<id> URL keeps working.
#
# The share creation + management UI lives only in the new Trace Explorer
# (traces v2). The legacy trace drawer's Share button is removed.

Feature: Share a trace behind a secret, scoped, expiring link
  As an operator who wants to show a trace to someone
  I want a share link whose secret token is the only thing that grants access
  So that access cannot be gained by guessing trace IDs, and I can scope and
  time-box who sees it

  Background:
    Given I am logged into a project with trace sharing enabled

  Rule: A share link is created from a trace and carries an unguessable token

    @integration
    Scenario: Creating a share link for a trace mints a high-entropy token
      Given I am viewing a trace in the new Trace Explorer
      When I create a share link for the trace
      Then a link containing a high-entropy secret token is returned
      And the token is at least 128 bits of entropy
      And the link resolves to that trace for anyone who holds it

    # Thread sharing is parked: the read-only viewer renders a trace and
    # nothing else, so `createShare` accepts TRACE only and no code path binds
    # a link to a conversation. This keeps the system from minting a capability
    # nothing can redeem. Reinstate when the aggregate payload carries the
    # surrounding conversation (ADR-057 follow-up).
    @unit
    Scenario: A share link covers the trace alone
      Given I am viewing a trace that belongs to a thread
      When I create a share link for it
      Then the link records no conversation

    # @unimplemented: multi-link independence is an integration behavior (two
    # persisted rows resolving separately); the unit suite covers single-link
    # creation and resolution. Bind when an integration test exists.
    @integration @unimplemented
    Scenario: The same trace can have multiple concurrent links
      Given I have already created one share link for a trace
      When I create a second share link with a different visibility
      Then both links exist and resolve independently

  Rule: Visibility scopes who may resolve a link

    @integration
    Scenario: A public link resolves for an anonymous viewer
      Given a share link with public visibility
      When an unauthenticated person opens the link
      Then they can view the trace

    @integration
    Scenario: An organization link requires a member of the same organization
      Given a share link with organization visibility
      When an unauthenticated person opens the link
      Then access is denied
      When a member of a different organization opens the link
      Then access is denied
      When a member of the same organization opens the link
      Then they can view the trace

    @integration
    Scenario: A project link requires a member of the same project
      Given a share link with project visibility
      When a member of the project but not the sharer opens the link
      Then they can view the trace
      When a member of the organization outside the project opens the link
      Then access is denied

  Rule: Links expire by time or by view count

    @integration
    Scenario: A timed link stops resolving after its expiry
      Given a share link that expires in the past
      When someone opens the link
      Then access is denied because the link has expired

    @integration
    Scenario: A single-view link resolves exactly once
      Given a share link with a maximum of one view
      When someone opens the link for the first time
      Then they can view the trace
      When the link is opened again afterwards
      Then access is denied because the link has been consumed

    @unit
    Scenario: Simultaneous opens cannot beat the view cap
      Given a share link with a maximum of one view
      When two viewers open the link at the same moment
      Then at most one of them is granted access

    # A view is a viewing, not an HTTP request: within a short window the same
    # viewer re-opening the link (a refresh, a restored tab) does not spend
    # another. Authorization is still re-checked in full every time — only the
    # counting is deduped — so a revoked link stops working immediately.
    @unit
    Scenario: A viewer refreshing a single-view link keeps access
      Given a share link with a maximum of one view
      And a viewer who has already opened it
      When that same viewer reloads the link shortly afterwards
      Then they still see the trace
      And no further view is counted

    @unit
    Scenario: A different viewer cannot reuse someone else's viewing
      Given a share link with a maximum of one view that a viewer has opened
      When a different viewer opens the link
      Then access is denied because the link has been consumed

    @integration
    Scenario: One viewing session counts as a single view
      Given a share link with a maximum of one view
      When a viewer opens the link and the page loads the trace, its spans, evaluations and annotations
      Then the view is counted once, not once per underlying request

    @integration
    Scenario: A link with no expiry and no view cap resolves indefinitely
      Given a share link with no expiry and no view cap
      When someone opens the link repeatedly
      Then they can view the trace each time

  Rule: The anonymous surface is bounded in cost

    # The one read the open internet can drive. Each call costs several
    # analytics reads, so it is rate limited per link and per caller, and the
    # assembled payload is briefly reused — a shared trace is a snapshot, so
    # reuse changes nothing a viewer would notice.
    @unit
    Scenario: Opening a shared link too often is refused for a moment
      Given a share link opened far more often than a person would
      When the next request arrives inside the same window
      Then it is refused as too frequent
      And the link itself remains valid

    @unit
    Scenario: A very large trace shares its timeline without every step's detail
      Given a shared trace with more steps than one payload may carry
      When a holder opens the link
      Then the timeline is complete
      And step-by-step detail covers only the first steps
      And the viewer is told the detail was limited

    @unit
    Scenario: Two viewers with different redactions never see each other's payload
      Given two viewers of the same link whose permissions differ
      When both open the link
      Then each is served the payload built for their own permissions

  Rule: Authorization is by token possession, not by resource existence

    @integration
    Scenario: Knowing a shared trace's id is not enough to read it
      Given a trace that has an active public share link
      When an anonymous caller requests that trace by its trace id without the token
      Then access is denied

    @integration
    Scenario: A revoked link stops resolving
      Given an active share link for a trace
      When the sharer revokes the link
      Then opening the link afterwards is denied

  Rule: The plan visibility window and content redaction still apply to shared views

    @integration
    Scenario: A shared view cannot see beyond the project's data-retention window
      Given a trace older than the project's visibility window
      And a public share link for that trace
      When a viewer opens the link
      Then the trace is not shown, exactly as it would not be shown in-app

    @integration
    Scenario: An anonymous viewer is never shown costs
      Given a public share link for a trace with recorded costs
      When an unauthenticated person opens the link
      Then the trace is shown without any cost figures

    @integration
    Scenario: A member resolving a scoped link sees costs only if they may in-app
      Given an organization share link for a trace with recorded costs
      When a member who may view costs opens the link
      Then the costs are shown
      When a member who may not view costs opens the link
      Then the trace is shown without any cost figures

    @unit
    Scenario: Evaluator output never reveals content the viewer may not see
      Given a trace whose evaluations quote the trace's input and output in their explanations
      And a viewer who may not see the trace's captured content
      When the shared trace is resolved for that viewer
      Then the evaluation verdicts are shown without their explanations
      And no evaluator error stacktrace is ever included in a shared payload

  Rule: The anonymous surface stays exactly one endpoint

    @unit
    Scenario: Adding a new public endpoint is a deliberate, reviewed act
      Given the API's full procedure map
      When the public (unauthenticated) procedures are enumerated
      Then they match the reviewed allowlist exactly
      And introducing a new public procedure fails the suite until the allowlist is updated

  Rule: A trace-scoped link does not unlock the surrounding conversation

    # Holds by construction: the share payload has no conversation section at
    # all, so there is nothing to leak and nothing to gate.
    @unit
    Scenario: A shared link never reveals the surrounding conversation
      Given a share link for a trace that belongs to a thread
      When the holder opens the link
      Then the payload carries no conversation

  Rule: The shared link renders the new Trace Explorer, read-only

    # @unimplemented: browser-level rendering of the read-only page; needs an
    # e2e/UI test rather than a unit binding.
    @integration @unimplemented
    Scenario: A shared trace opens in the new Trace Explorer surface
      Given a public share link for a trace
      When an unauthenticated person opens the link
      Then they see the trace in the new Trace Explorer, filling the page
      And there is no drawer chrome to close, resize or dock

    # @unimplemented: the read-only affordance-suppression is a UI behavior
    # (no session-dependent actions rendered); needs an e2e/UI test.
    @integration @unimplemented
    Scenario: The shared view offers nothing that needs an account
      Given a public share link for a trace
      When an unauthenticated person opens the link
      Then they cannot rename the trace
      And they cannot pin it, share it, or add it to a dataset
      And no request is made that requires them to be signed in

    @integration
    Scenario: One page load counts as one view
      Given a share link with a maximum of one view
      When a viewer opens the link once
      Then exactly one view is counted
      And the trace is shown

  Rule: Legacy links keep working; the legacy UI no longer offers sharing

    # @unimplemented: exercises the migration's token backfill against a real
    # DB; needs an integration test with the migrated schema.
    @integration @unimplemented
    Scenario: An existing pre-migration share URL still resolves
      Given a share link that existed before the redesign
      When someone opens its original /share/<id> URL
      Then they can view the trace

    # @unimplemented: absence of a UI button in the legacy drawer; needs an
    # e2e/UI test.
    @integration @unimplemented
    Scenario: The legacy trace drawer has no Share affordance
      Given I am viewing a trace in the legacy trace drawer
      Then there is no Share button

  Rule: The kill switch works at both the organization and project level

    # Effective sharing = organization AND project (ADR-057). The org toggle is
    # the global switch; the project toggle scopes the kill to one project —
    # mirrors the presence kill switch.

    @integration
    Scenario: Disabling trace sharing for a project revokes all its links
      Given a project with several active trace share links
      When an admin disables trace sharing for the project
      Then none of the existing links resolve
      And no new share links can be created

    @integration
    Scenario: Disabling trace sharing for the organization disables it everywhere
      Given an organization with trace sharing enabled
      And two projects in that organization, each with active trace share links
      When an admin disables trace sharing for the organization
      Then none of the existing links in either project resolve
      And no new share links can be created in either project

    @unit
    Scenario: A link is resolvable only while both org and project allow sharing
      Given an active public share link for a trace
      When the organization has trace sharing disabled
      Then the link does not resolve, exactly as a bad token would not
      When the organization allows sharing but the project has it disabled
      Then the link does not resolve, exactly as a bad token would not
      When both the organization and the project allow sharing
      Then the link resolves
