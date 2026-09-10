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
    Scenario: The bucket width is daily whichever report is chosen
      Given the report is set to usage
      When the admin looks at the bucket width field
      Then the only entry offered is the daily one
      And it carries no value, so the adapter's own default decides
      And that default is daily, so the entry does not name a width the
        source will not be read at
      # The finer widths multiply the rows a day costs and change no
      # figure the pillar shows, because every screen that reads this data
      # reads it by day. The entry stays empty rather than spelling "1d"
      # out, so daily is written down once, in the adapter's schema.

    @unit
    Scenario: A source already reading hourly keeps reading hourly
      Given a usage source was saved with an hourly bucket width
      When the admin opens that source to edit it
      Then the hourly width is offered alongside the daily one
      And the field still holds hourly
      # The form drops any held value its picker does not offer, so
      # offering daily alone would have moved this source to daily the
      # next time anyone opened it for an unrelated change -- a settings
      # change nobody asked for and nothing announced. The finer widths
      # are withdrawn from new sources, not taken off the ones already
      # reading at them; the admin can still move to daily by choosing it.

    @unit
    Scenario: A width the cost report would reject is not kept either
      Given a cost source was somehow saved with an hourly bucket width
      When the admin opens that source to edit it
      Then the only entry offered is the daily one
      # The puller ignores the width on a cost source, so the stored one
      # was never in effect. Keeping it would show the admin a setting
      # that does nothing, and the builder refuses it anyway.

    @unit
    Scenario: The report opens on the one almost every organization wants
      When the admin opens the form without touching the report field
      Then the report field holds the cost report
      And the form still marks the report as required
      And an unselected entry carrying no value is still offered
      # Cost is the provider's own figure for what was spent, which is
      # what this source is added for; usage is the specialist choice made
      # by someone who wants our pricing applied to raw token counts. The
      # empty entry remains so clearing the field is possible — the form
      # then refuses the save and marks the field rather than quietly
      # putting the default back.

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
