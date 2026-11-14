# Decisions: dev/docs/adr/201-braids-show-matching-spans-in-another-projects-traces.md
# (ADR-201). The braid's rules live in braids.feature and the screen in braids-screen.feature;
# this file is the release flag braid management sits behind. Signing keys: the api-key
# module's signing-keys.feature.
#
# Bound by unit and integration tests in authz, navigation and api-key.

@authz @braids
Feature: Braid management behind the release_braids flag
  As LangWatch
  I want braid management switched on per organisation
  So that braids roll out gradually without breaking the braids an organisation already has

  Background:
    Given an Enterprise organisation with plain projects "orchestrator" and "specialists"
    And ana, an organisation admin

  Rule: Off by default, the Braids screens are not there

    @integration
    Scenario: With release_braids off both Braids pages answer not-found
      Given release_braids is off for the organisation
      When ana opens the project Braids page or the organisation Braids page
      Then each answers not-found and shows nothing of braids

    @integration
    Scenario: With release_braids on the Braids pages are past the flag
      Given release_braids is on for the organisation
      When a reader without the page's permission opens either Braids page
      Then each names the permission it needs instead of answering not-found

    @unit
    Scenario: With release_braids off the settings menu offers no Braids entry
      Given release_braids is off for the organisation
      When the settings menu is built for ana
      Then it offers no Braids entry, for the project page or the organisation page

    @integration
    Scenario: The settings menu hides Braids while release_braids has not answered
      Given the release_braids reading is still loading
      When the settings menu is built for ana
      Then it offers no Braids entry until the flag answers on

  Rule: Every braid management procedure refuses while the flag is off

    @integration
    Scenario: With release_braids off every braid management procedure refuses with braids_not_enabled
      Given release_braids is off for the organisation
      When ana creates, changes, removes or lists braids, lists the organisation's braids, lists braid targets, counts who would see the spans, or reads or sets who may braid
      Then each call is refused with braids_not_enabled
      And no braid is written

    @integration
    Scenario: With release_braids on braid management answers again
      Given release_braids is on for the organisation
      When ana creates a braid from "specialists" into "orchestrator" and lists it
      Then the braid is created and listed

    @unit
    Scenario: A project with no organisation is refused as braids not enabled
      Given a project id no organisation holds
      When braid management is asked about it
      Then it is refused with braids_not_enabled, since no organisation answers the flag

  Rule: Braids already made keep applying while the flag is off

    @integration
    Scenario: Existing braids still apply to trace reads while release_braids is off
      Given a live braid from "specialists" into "orchestrator"
      And release_braids is then switched off for the organisation
      When a member of "orchestrator" reads its traces
      Then the read still carries "specialists" through the braid
