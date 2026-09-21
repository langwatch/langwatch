# SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
Feature: The Copilot Studio create form reads by purpose, and one app registration is the default
  As an organization admin adding a Copilot Studio source
  I want the fields grouped by what they are for, with one credential unless I
  choose two
  So that the common setup is one app registration pasted once, and the
  least-privilege setup with a separate billing app stays one switch away

  What this file deliberately does NOT restate (already owned elsewhere):
  a subscription claim demanding a billing credential at save time, the
  bill never borrowing the conversation credential at run time, and the
  prepaid declaration (azure-billing-identity.feature). Secrets never
  echoing back to the browser is generic. Read seats stay in the Advanced
  group by their own documented decision — the usage group here is the
  conversation credential, not the seats switch. The directory switch is
  the deliberate exception to that decision and has a rule of its own
  below: it looks like the seats switch and is not, because turning it off
  empties the screens that name people.

  Everything edit-mode is out of scope: this source type is not editable
  today, and making it so is issue #7777 (the sealed-credential envelope
  question). The one-app choice is persisted on create precisely so that
  work can restore it later without guessing from sealed secrets.

  Background:
    Given an organization with the ingestionSources:manage permission
    And the source composer is open on the copilot_studio_dataverse adapter

  Rule: The form reads by purpose, not as one list

    @unit
    Scenario: The fields stand in labelled groups, choices last
      When the admin looks at the form
      Then the connection fields stand first under their own heading
      And the subscription claim stands second under the cost heading
      And the conversation credential stands third under its own heading
      And the billing choice stands last under its own heading
      And the prepaid declaration sits in the Advanced group
      # Required paste-work first, choices whose default already answers
      # last: the billing switch refers back to the conversation credential
      # above it, and the prepaid declaration is a disagreement with the
      # pay-as-you-go default, which is what Advanced is for.

  Rule: One app registration is the default, a second one is a choice

    @unit
    Scenario: A new source starts with one app registration for everything
      When the admin opens the form for a new source
      Then the one-app switch is on
      And no billing credential field is shown

    @unit
    Scenario: With one app chosen, the saved bill credential is the conversation one
      Given the one-app switch is on
      And the admin typed the conversation credential
      And the admin named an Azure subscription
      When the admin saves the source
      Then the saved billing client ID equals the conversation client ID
      And the saved billing secret equals the conversation secret
      # The copy happens in the form, from values the admin just typed —
      # never as a server fallback, which azure-billing-identity.feature
      # forbids. On create nothing is sealed, so the copy is always whole.

    @unit
    Scenario: Turning the switch off reveals the billing credential fields
      Given the one-app switch is on
      When the admin turns the one-app switch off
      Then the billing credential fields appear
      And what the admin types there is what is saved for the bill

    @unit
    Scenario: A source claiming no subscription saves no billing credential
      Given the one-app switch is on
      And the admin typed the conversation credential
      And no Azure subscription is named
      When the admin saves the source
      Then the saved configuration carries no billing credential
      # The switch decides which credential reads the bill, never whether
      # a bill is read. That is the subscription's job alone.

  Rule: The choice is written down, not left to be reconstructed from secrets

    @unit
    Scenario: The one-app choice is saved alongside the configuration
      Given the admin typed the conversation credential
      And the admin named an Azure subscription
      When the admin saves the source with the one-app switch on
      Then the saved configuration records that one app was chosen
      # Stored secrets are sealed on any future read — equality between
      # the billing pair and the conversation pair can never be checked
      # after the fact. The flag is the only durable record of the choice,
      # and the edit work in #7777 will read it instead of guessing.

    @unit
    Scenario: Choosing two apps is recorded too
      Given the admin typed the conversation credential
      And the admin named an Azure subscription
      And the admin typed a billing credential of its own
      When the admin saves the source with the one-app switch off
      Then the saved configuration records that two apps were chosen

  Rule: The directory read is offered on the way in, and read unless refused

    @unit
    Scenario: A new source starts set to record people and departments
      When the admin opens the form for a new source
      Then the directory switch is on
      And it stands among the fields the admin can see without expanding
        anything
      # Not in the Advanced group beside the seats switch, which it
      # otherwise resembles. Turning this one off leaves every person and
      # department screen empty and every agent unowned, and a choice with
      # that consequence is made in front of the admin, not behind a
      # collapsed heading they never opened.

    @unit
    Scenario: An untouched switch saves the state it was showing
      Given the admin typed the conversation credential
      When the admin saves the source without touching the directory switch
      Then the saved configuration reads the directory
      # The switch and the builder read one declared default. Split, the
      # form shows a directory read that the saved source does not do.

    @unit
    Scenario: A refusal is saved as a refusal
      Given the admin typed the conversation credential
      And the admin turned the directory switch off
      When the admin saves the source
      Then the saved configuration does not read the directory
      # The consent is real: reading the directory needs a permission that
      # covers every user in the tenant. An admin who declines it must not
      # find the setting back on because they never wrote anything down.

  Rule: The copy is made at save time, from what the form holds now

    @unit
    Scenario: Billing values typed before flipping back to one app are not saved
      Given the one-app switch was turned off
      And the admin typed a billing credential of its own
      When the admin turns the one-app switch back on
      And saves the source with a subscription named
      Then the saved billing client ID equals the conversation client ID
      And the saved billing secret equals the conversation secret
      # The form deliberately never erases what an admin typed when a
      # switch hides it — flipping back must not resurrect it either. The
      # copy is decided at save time by the switch, not by leftover state.
