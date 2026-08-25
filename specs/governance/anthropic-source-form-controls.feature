# SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
Feature: Choose Anthropic adapter settings instead of typing them
  As an organization admin adding or editing an Anthropic Admin API source
  I want the fields whose answers come from a fixed list to be pickers
  So that I choose from what the adapter accepts rather than recalling it from
  a hint and learning I was wrong from a rejected save

  Background:
    Given an organization with the ingestionSources:manage permission
    And the source composer is open on the anthropic_admin adapter

  Rule: A field with a closed set of answers is chosen, not typed

    @unit
    Scenario: The report offers the two reports that exist and nothing else
      When the admin looks at the report field
      Then the choices are exactly the usage report and the cost report

    @unit
    Scenario: The bucket widths offered are the ones the adapter declares
      Given the report is set to usage
      When the admin looks at the bucket width field
      Then the widths offered are the ones the adapter's own schema accepts
      And no width is offered that the adapter would reject

    @unit
    Scenario: A required choice does not answer itself
      When the admin opens the form without touching the report field
      Then the report field offers an unselected entry carrying no value
      And the form still marks the report as required

  Rule: A setting the cost report would reject is not offered on a cost source

    @unit
    Scenario: The cost report offers no width to choose between
      Given the report is set to cost
      When the admin looks at the bucket width field
      Then the only entry offered carries no value
      And the field explains that the cost report is always daily

    @unit
    Scenario: Switching to the cost report drops a width already chosen
      Given the report is set to usage
      And the admin has chosen a bucket width of 1h
      When the admin changes the report to cost
      Then the bucket width is cleared
      And the configuration builds instead of refusing the unusable width

  Rule: A date is picked on a calendar, and an instant survives being shown on one

    @unit
    Scenario: The backfill start is a date control
      When the admin looks at the backfill start field
      Then it is rendered as a date control rather than a free-text field

    @unit
    Scenario: A stored instant is shown as its calendar date
      Given the source was saved with a backfill start of "2026-08-01T00:00:00.000Z"
      When the admin opens the edit form
      Then the backfill start shows the 1st of August 2026

    @unit
    Scenario: Showing an instant on a date control does not rewrite it
      Given the source was saved with a backfill start of "2026-08-01T13:45:00.000Z"
      When the admin edits another field and saves
      Then the submitted backfill start is still that same instant

  Rule: Replacing the control does not change what is stored

    @unit
    Scenario: Leaving the bucket width alone still means the adapter default
      Given the report is set to usage
      When the admin saves without choosing a bucket width
      Then the submitted configuration carries no bucket width at all

    @unit
    Scenario: A picked date is still normalized to an instant before saving
      When the admin picks a backfill start of "2026-08-01"
      And saves the form
      Then the submitted backfill start is a timezone-carrying instant
