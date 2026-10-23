# Decisions: dev/docs/adr/183-braids-show-matching-spans-in-another-projects-traces.md
# (ADR-183). Design: dev/docs/plans/braids/braids-prototype.html, steps 1 to 4, 7 and 9.
# The braid's rules live in braids.feature; this file is what the screen offers and says.
#
# Bound by rendered integration tests.

@authz @braids @ui
Feature: The Braids screen
  As an admin of a project
  I want to see, create, change and remove braids from the project's settings
  So that I can decide what leaves a project and see what arrives in it

  Background:
    Given an Enterprise organisation with plain projects "orchestrator" and "specialists"
    And an organisation admin named ana viewing the settings of "specialists"

  Rule: The page explains braids before there are any

    @integration
    Scenario: A project with no braids says what a braid does
      Given "specialists" has no braids
      When ana opens Braids in the project settings
      Then the page says in one sentence what a braid does, with a link to the guide
      And it offers New braid and a link to the guide in the page header
      And it shows tabs for braids into other projects, braids from other projects and signing keys, each with its count

  Rule: The dialog builds a braid and shows what the reader will see

    @integration
    Scenario: The braid starts from this project and picks where it goes
      When ana starts a new braid
      Then the project it braids from is "specialists" and cannot be changed
      And the project picker lists the plain projects ana can read
      And aggregate projects and "specialists" itself are listed but disabled, each with the reason

    @integration
    Scenario: A team admin is offered only the projects they can read
      Given tom is an admin of the team holding "specialists" and cannot read "orchestrator" traces
      When tom starts a new braid from "specialists"
      Then "orchestrator" is not offered
      And the picker says a braid can only go into a project whose traces you can read

    @integration
    Scenario: The dialog says what the reader already sees from this project
      Given a live braid from "specialists" into "orchestrator"
      When ana picks "orchestrator" for a new braid
      Then the dialog says "orchestrator" already sees spans from 1 braid from "specialists"
      And it shows that braid's condition and data window above the condition

    @integration
    Scenario: A further braid on the same pair says what it adds
      Given a live braid from "specialists" into "orchestrator"
      When ana previews another braid from "specialists" into "orchestrator"
      Then the preview counts what "orchestrator" will see with both braids
      And says how many more spans the new braid shows

    @integration
    Scenario: The condition is checked as it is typed
      When ana types attributes["orchestrator"] == "web" or attributes["team"] == "a"
      Then the editor marks the or and explains how to write the condition instead
      And the create button stays disabled until the condition is supported

    @integration
    Scenario: The attributes this project's spans carry can be inserted into the condition
      When ana picks an attribute from the ones "specialists" spans carry
      Then it is inserted into the condition at the cursor

    @integration
    Scenario: The signed calls switch and the condition stay in step
      Given "orchestrator" has a signing key in use
      When ana turns on only signed calls
      Then Verified("orchestrator") is added to the condition
      And deleting it from the condition turns the switch off
      And the switch says which key "orchestrator" signs with and when it was last used

    @integration
    Scenario: Only signed calls offers to set up signing when the reader has no key
      Given "orchestrator" has no signing key
      When ana turns on only signed calls
      Then the switch says "orchestrator" does not sign its calls yet and links to its signing keys
    @integration
    Scenario: The preview counts what the reader will see as the condition changes
      When ana stops typing a supported condition
      Then the preview counts "orchestrator" traces over the last 7 days that get every, some or none of their "specialists" spans
      And with only signed calls on it counts the spans that stay hidden for having no valid signature
      And it shows an example trace with the braided spans marked and the rest struck through, seen by ana only

    @integration
    Scenario: Testing a trace shows it exactly as the reader will see it
      When ana tests the condition against an "orchestrator" trace id
      Then that trace is shown with exactly the spans "orchestrator" will see

    @integration
    Scenario: The dialog names how many people will see the spans
      When ana picks "orchestrator" as the project to braid into
      Then the dialog says how many members of "orchestrator" will see the braided spans

    @integration
    Scenario: Creating the braid names the project it goes into
      When ana completes a supported condition, a start date and an end choice
      Then the create button reads "Braid into orchestrator"
      And creating closes the dialog and lists the new braid

    @integration
    Scenario: Editing a braid saves only a change
      Given a live braid from "specialists" into "orchestrator"
      When ana opens Edit on it
      Then the reader is fixed and Save stays off until the condition, start or end changes
      And saving the changed braid replaces it

  Rule: The list shows each braid and what it is doing

    @integration
    Scenario: Each braid row shows where it goes, its condition, its access and its activity
      Given a live braid from "specialists" into "orchestrator"
      When ana opens Braids
      Then the row shows the reader, the condition, the start date, the end date and the braided spans over the last 24 hours
      And its menu offers Edit, View in audit log and Remove braid

    @unit
    Scenario: Two braids on one pair from the same day show their start times
      Given two braids from "specialists" into "orchestrator" that start on 1 Oct 2026
      Then each row's From shows the time as well as the day
      And a braid alone on its pair shows only the day

    @unit
    Scenario: A link opens the Braids page on its Signing keys tab
      When a link names the Signing keys tab of another project's Braids page
      Then the project switch opens that project and the page lands on Signing keys

    @integration
    Scenario: Removing a braid says what stops before it happens
      Given a live braid from "specialists" into "orchestrator"
      When ana chooses Remove braid
      Then a confirmation says "orchestrator" stops seeing "specialists" spans and the removal is audited
      And confirming removes the braid and says so

    @integration
    Scenario: The reader's admins may remove a braid from their side but not change it
      Given a live braid from "specialists" into "orchestrator"
      And olu is an admin of the team holding "orchestrator" with no role on "specialists"
      When olu opens Braids in the settings of "orchestrator"
      Then the braid from "specialists" is listed with its condition and access
      And it offers Remove braid and no Edit

    @integration
    Scenario: A project admin is told when the organisation keeps braids to its admins
      Given the organisation keeps braids to its admins
      And tom is an admin of the team holding "specialists"
      When tom opens Braids in the settings of "specialists"
      Then the braids are listed and no New braid, Edit or Remove is offered
      And the page says the organisation's admins manage braids, with a link to ask one

    @integration
    Scenario: An organisation admin chooses who may braid
      When ana opens Braids in the organisation settings
      Then every braid in the organisation is listed
      And a setting offers to keep braids to organisation admins, saying project admins can braid until it is on

    @integration
    Scenario: A member who is not an admin sees the braids but cannot change them
      Given a member named sam who is not an admin
      When sam opens Braids
      Then the braids are listed
      And no New braid, Edit or Remove is offered

  Rule: Below Enterprise the page says what Braids does

    @integration
    Scenario: An organisation below Enterprise sees what Braids offers
      Given an organisation below Enterprise
      When ana opens Braids
      Then the page explains braids and offers a conversation about Enterprise
      And nothing half-works

    @integration
    Scenario: After leaving Enterprise the page says braids are paused and kept
      Given a live braid from "specialists" into "orchestrator"
      And the organisation has left Enterprise
      When ana opens Braids
      Then a banner says braids are paused and start again on upgrade
      And each braid row is marked paused
