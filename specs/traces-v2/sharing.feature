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
# (bare high-entropy nanoid, unprefixed), an optional `threadId` (share a trace with its
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

    @integration
    Scenario: Sharing a trace together with its thread
      Given I am viewing a trace that belongs to a thread
      When I create a share link and choose to include the surrounding thread
      Then the link records the thread id alongside the trace id
      And a holder of the link sees the trace within its conversation

    @integration
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

  Rule: A trace-scoped link does not unlock the surrounding conversation

    @integration
    Scenario: The conversation is revealed only when the link was created with its thread
      Given a share link created for a trace without its thread
      When the holder requests the surrounding conversation
      Then access is denied
      Given a share link created for the same trace with its thread
      When the holder requests the surrounding conversation
      Then the conversation is returned

  Rule: The shared link renders the new Trace Explorer, read-only

    @integration
    Scenario: A shared trace opens in the new Trace Explorer surface
      Given a public share link for a trace
      When an unauthenticated person opens the link
      Then they see the trace in the new Trace Explorer, filling the page
      And there is no drawer chrome to close, resize or dock

    @integration
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

    @integration
    Scenario: An existing pre-migration share URL still resolves
      Given a share link that existed before the redesign
      When someone opens its original /share/<id> URL
      Then they can view the trace

    @integration
    Scenario: The legacy trace drawer has no Share affordance
      Given I am viewing a trace in the legacy trace drawer
      Then there is no Share button

  Rule: The project-level kill switch still revokes and disables sharing

    @integration
    Scenario: Disabling trace sharing revokes all existing links
      Given a project with several active trace share links
      When an admin disables trace sharing for the project
      Then none of the existing links resolve
      And no new share links can be created
