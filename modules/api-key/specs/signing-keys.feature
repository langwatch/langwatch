# Decisions: dev/docs/adr/201-braids-show-matching-spans-in-another-projects-traces.md
# (ADR-201) section 4. How a signature is checked at ingest:
# modules/trace/specs/signed-calls.feature. Design: dev/docs/plans/braids/braids-prototype.html,
# step 2.
#
# The server half is bound at unit level: the door's refusals and audit through the real
# tRPC runtime with test decisions (signing-key.trpc.unit.test.ts); the screen through the lent
# keys panel (signing-keys-panel.integration.test.tsx); the organisation's braid setting through
# the door and the authz module's own engine (signing-key.braids-admins-only.integration.test.ts).

@api-key @braids
Feature: Signing keys
  As an admin of a project that calls other projects
  I want the project to sign the tags on its calls with a key only it holds
  So that braids can require that the project really made the call

  Background:
    Given an Enterprise organisation with a plain project "orchestrator"
    And an organisation admin named ana

  Rule: A signing key's secret is shown once, when it is created

    @integration
    Scenario: Creating a signing key shows its secret once
      When ana creates a signing key named "Production" for "orchestrator"
      Then the secret is returned by that create and by nothing else
      And the screen shows it once, with setup snippets for TypeScript, Python and Go

    @unit
    Scenario: No read returns a signing key's secret
      Given "orchestrator" holds a signing key
      When its keys are listed or one is read
      Then no answer carries the secret

    @unit
    Scenario: A signing key's secret is stored encrypted
      When ana creates a signing key
      Then the stored row holds the secret only in encrypted form

    @unit
    Scenario: A signing key is never the project's API key
      When ana creates a signing key for "orchestrator"
      Then it is neither derived from nor stored beside the project's API key

  Rule: Keys rotate with an overlap and revoke at once

    @unit
    Scenario: Rotating a key keeps the old one verifying for seven days
      Given "orchestrator" holds a signing key in use
      When ana rotates it
      Then a new secret is shown once
      And the old key is listed as verifying until seven days from now

    @unit
    Scenario: Revoking a key ends it at once
      Given "orchestrator" holds a signing key in use
      When ana revokes it
      Then the key is listed as revoked
      And spans signed with it stop being marked verified within a minute

    @unit
    Scenario: Spans signed with unknown key ids cost no database read each
      Given "orchestrator" holds a signing key in use
      When spans arrive signed with many key ids no organisation holds
      Then each is left unverified as an unknown key
      And the organisation's keys are read from the store once a minute, not once per span
      And the key in use still verifies

    @unit
    Scenario: A failed early re-read keeps the keys already held verifying
      Given "orchestrator" holds a signing key whose spans verified in the last minute
      When a span signed with an unknown key id asks for an early re-read and the store is down
      Then that span is left unverified as unavailable
      And spans signed with the held key still verify until the held keys' minute ends

    @unit
    Scenario: One signing key whose secret will not open leaves the others verifying
      Given the organisation holds two live signing keys and one's stored secret will not open
      When spans signed with each arrive
      Then the span signed with the unreadable key is left unverified as unavailable
      And the span signed with the other key still verifies

  Rule: Who may manage signing keys

    @unit
    Scenario: Signing keys need the Enterprise plan
      Given an organisation below Enterprise
      When ana asks to create or rotate a signing key
      Then each is refused with enterprise_plan_required naming the Braids feature

    @unit
    Scenario: A signing key can be revoked on any plan
      Given an organisation that dropped below Enterprise holding a leaked signing key
      When ana revokes it
      Then it is revoked, as stopping a braid is allowed on any plan

    @unit
    Scenario: Whoever may braid out of a project manages its signing keys
      Given tom is an admin of the team holding "orchestrator"
      When tom creates, rotates and revokes a signing key for "orchestrator"
      Then each succeeds
      And tom's request for a key of a project in another team is refused as a permission denial

    @integration
    Scenario: With braids kept to organisation admins, a team admin may not manage signing keys
      Given the organisation keeps braids to its admins
      And tom is an admin of the team holding "orchestrator"
      When tom asks to create a signing key for "orchestrator"
      Then it is refused as a permission denial

    @unit
    Scenario: A member may not create, rotate or revoke a signing key
      Given a member named sam who is not an admin
      When sam asks to create a signing key for "orchestrator"
      Then it is refused as a permission denial

    @integration
    Scenario: Someone who may not manage signing keys is told who does
      Given sam may open the Braids page of "orchestrator" but may not braid out of it
      When sam opens its signing keys
      Then sam is told that whoever may braid out of "orchestrator" manages them
      And creating a key is off, and no key of "orchestrator" is read for sam

    @unit
    Scenario: Creating, rotating and revoking a signing key is in the audit log
      When ana creates, rotates and then revokes a signing key
      Then the audit log holds one entry for each, naming the key and never its secret

  Rule: The keys list says whether each key is working

    @unit
    Scenario: Each key shows its status and its signed spans over the last 24 hours
      Given "orchestrator" holds a signing key whose signatures passed and failed in the last 24 hours
      When ana opens the signing keys of "orchestrator"
      Then the key's row shows its status, when it was created and last used, and how many signed spans passed and failed

  Rule: Whoever braids into a project can see whether it signs its calls

    @unit
    Scenario: A braid's author sees whether the reader signs without managing its keys
      Given tom may read the traces of "orchestrator" but may not manage its signing keys
      When tom asks whether "orchestrator" signs its calls
      Then tom is told the name of its key used last and when, and never a key id or secret
      And someone who may not read the traces of "orchestrator" is refused

    @unit
    Scenario: A project signs its calls with its live key used last
      Given "orchestrator" holds a revoked key, a key never used and a key used an hour ago
      When whether "orchestrator" signs its calls is asked
      Then the answer names the key used an hour ago
      And a project with only revoked keys signs nothing

  Rule: Signing keys are braid management, behind release_braids, except listing and revoking
    # The flag itself: modules/authz/specs/braids-release-flag.feature. Decided by Alex, 2026-11-18
    # (option 1a): keys still verify while the flag is off, so a leaked key must be found to revoke.

    @unit
    Scenario: With release_braids off issuing and reading signing refuse with braids_not_enabled
      Given "orchestrator" holds a signing key
      And release_braids is off for the organisation
      When its signing is asked, or a key is created or rotated
      Then each call is refused with braids_not_enabled
      And no key is issued

    @unit
    Scenario: Listing signing keys still works while release_braids is off
      Given "orchestrator" holds a signing key
      And release_braids is off for the organisation
      When its keys are listed
      Then the key is listed, so a leaked key can be found and revoked

    @integration
    Scenario: With release_braids off the keys panel offers Revoke but not Rotate or New key
      Given "orchestrator" holds a signing key
      And release_braids is off for the organisation
      When ana opens the key's actions on the Braids page, which was linked to New signing key
      Then Revoke is offered and Rotate is not
      And the New signing key form does not open

    @unit
    Scenario: Revoking a signing key still works while release_braids is off
      Given "orchestrator" holds a signing key
      And release_braids is off for the organisation
      When ana revokes the key
      Then it is revoked at once, since revoking only narrows access

    @unit
    Scenario: release_braids is answered for each organisation's signing keys on its own
      Given release_braids is on for one organisation and off for another
      When a signing key is created for a project in each
      Then the released organisation's project gets its key
      And the other organisation's project is refused with braids_not_enabled

    @unit
    Scenario: Signed calls are still verified while release_braids is off
      Given "orchestrator" holds a signing key issued while release_braids was on
      And release_braids is then switched off for the organisation
      When a span arrives signed with that key
      Then its signature is still verified as orchestrator's

  Rule: Issuing and rotating signing keys waits until the organisation turns Braids on
    # Decided by Alex, 2026-11-18: Braids is on by default but an organisation admin turns it on
    # in settings. The setting: modules/authz/specs/braids.feature.

    @unit
    Scenario: With Braids turned off a signing key cannot be created or rotated
      Given "orchestrator" holds a signing key
      And the organisation has Braids turned off
      When a key is created or rotated
      Then each call is refused with braids_turned_off
      And its keys are still listed and a key can still be revoked
