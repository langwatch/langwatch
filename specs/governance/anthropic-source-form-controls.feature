# SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
Feature: Choose Anthropic adapter settings instead of typing them
  As an organization admin adding or editing an Anthropic Admin API source
  I want each setting rendered as the shape of its own answer — a toggle for a
  two-state choice, a calendar for a day — and settings with one right answer
  not asked at all
  So that I choose from what the adapter accepts rather than recalling it from
  a hint and learning I was wrong from a rejected save

  Background:
    Given an organization with the ingestionSources:manage permission
    And the source composer or the edit drawer is open on the anthropic_admin
      adapter — the create form unless a scenario opens an existing source

  Rule: A setting with two states and a right answer for almost everyone is a toggle

    @unit
    Scenario: The report is one toggle named for what the admin gets
      When the admin looks at the report field
      Then it is rendered as a toggle rather than a list
      And the toggle is labelled "Use Anthropic's reported cost"
      # The old picker asked the admin to read two report names and work out
      # which one they were always going to choose. There are exactly two
      # states and one of them is right for almost every organization, which
      # is the case a toggle exists for.

    @unit
    Scenario: The toggle explains both sides in plain words
      When the admin reads the hint beside the report toggle
      Then it says that on records the provider's own daily spend figure,
        which is what almost everyone wants
      And that off records raw token counts that we price ourselves
      And that one source records one report only, never both

    @unit
    Scenario: A new source opens on the provider's own cost figure
      When the admin opens the form without touching the report toggle
      Then the toggle is on
      And saving without touching it records the cost report

    @unit
    Scenario: Turning the toggle off records the usage report
      When the admin turns the report toggle off
      And saves
      Then the submitted configuration records the usage report
      # The stored words are unchanged: the adapter still reads "cost" and
      # "usage", so the toggle is a different way of asking the same question
      # and not a change to what any existing source holds.

    @unit
    Scenario: A source saved on the usage report opens with the toggle off
      Given a source was saved on the usage report
      When the admin opens that source to edit it
      Then the report toggle is off
      And saving an unrelated change still records the usage report

    @unit
    Scenario: The report can no longer be left unanswered
      When the admin works through the whole form
      Then there is no way to put the report back to no report at all
      And the save is never refused for a missing report
      # The picker carried an empty entry so a cleared field could be refused
      # rather than quietly refilled. A toggle has no empty state, so the
      # whole "no report yet" detour it existed for is gone.

  Rule: A locked setting still says what it holds, in the words of the setting

    @unit
    Scenario: A locked report names the report rather than a switch position
      Given a usage source has already pulled
      When the admin opens that source to edit it
      Then the report reads "Usage report"
      And a cost source that has already pulled reads "Cost report"
      # "Off" is the position of a control the admin can no longer see. The
      # locked field has to answer the question the admin actually has, which
      # is which report this source records.

    @integration
    Scenario: A locked report is still readable and still reachable
      Given a cost source has already pulled
      When the admin reaches the report field with the keyboard
      Then the field is reachable and its value readable
      And it cannot be changed
      # Same rule the locked picker already kept: a disabled control drops out
      # of the tab order, where a keyboard or screen-reader user cannot read
      # what it holds.

  Rule: A setting with one correct answer is not offered at all

    @unit
    Scenario: The form offers no bucket width, on either report
      When the admin works through the whole form with the toggle on
      And again with the toggle off
      Then no bucket width field appears in either
      # Every screen that reads this data reads it by day, so a finer width
      # multiplies the rows a day costs and changes no figure the pillar
      # shows. Asking was the mistake; the answer was always daily.
      # The setting itself is still carried by the form, just never asked:
      # a source saved at an hourly width has to survive an edit, and a
      # field the form has stopped declaring is a field the edit path drops.

    @unit
    Scenario: A usage source is written down as daily
      When the admin turns the report toggle off and saves
      Then the submitted configuration records a daily bucket width
      # Written explicitly rather than left out: the adapter defaults to daily
      # too, but a source whose stored config says nothing cannot be told from
      # one saved before the field existed, and daily is what this source runs
      # at either way.

    @unit
    Scenario: A cost source carries no bucket width
      When the admin saves with the report toggle on
      Then the submitted configuration carries no bucket width at all
      # The puller pins the cost report to daily and ignores anything else, so
      # writing a width there would record a setting that does nothing.

    @unit
    Scenario: A source already reading hourly keeps reading hourly
      Given a usage source was saved with an hourly bucket width
      When the admin opens that source, changes its name and saves
      Then the submitted configuration still records the hourly width
      # The finer widths are withdrawn from new sources, not taken off the
      # ones already reading at them. An admin editing a name has not asked
      # for a settings change, and nothing here would have announced one.

    @unit
    Scenario: An hourly width on a cost source is dropped rather than refusing the save
      Given a source holds an hourly bucket width
      When the admin leaves the report toggle on and saves
      Then the configuration builds
      And it carries no bucket width
      # The width was never in effect on a cost source, so there is nothing to
      # preserve and no reason to refuse a save over it.

  Rule: A date is picked on a calendar, and an instant survives being shown on one

    @unit
    Scenario: The backfill start asks in plain words when to start reading
      When the admin looks at the backfill start field
      Then it is labelled "Read history from"
      And it is rendered as a date control rather than a free-text field
      And the hint says this is the first day we read data for
      And that later runs continue forward from where the last one stopped
      And that clearing it reads only the last few days
      # "Backfill start" is our word for it, and "optional" described the form
      # rather than the setting. The admin's question is how far back to read.

    @unit
    Scenario: A new Anthropic source proposes six months of history
      When the admin opens the form for a new source
      Then the backfill start holds midnight UTC six months before today
      # Far enough back to show a trend the day the source is added, and
      # inside what this provider serves. The number lives in one declared
      # table beside the cadence defaults, so the proposal and any hint that
      # describes it cannot drift apart.

    @unit
    Scenario: Editing shows the stored date rather than proposing a new one
      Given the source was saved with a backfill start of "2026-08-01T00:00:00.000Z"
      When the admin opens the edit form
      Then the backfill start shows the 1st of August 2026
      And it is not replaced by six months before today
      # The proposal is a starting point for a source that does not exist yet.
      # Re-seeding an existing one would move a date that has already been
      # read from, on a form the admin opened for something else.

    @unit
    Scenario: Clearing the proposed date still means the adapter's own default
      When the admin clears the backfill start and saves
      Then the submitted configuration carries no backfill start at all
      And the adapter's own default decides how far back the first run reads

    @unit
    Scenario: Showing an instant on a date control does not rewrite it
      Given the source was saved with a backfill start of "2026-08-01T13:45:00.000Z"
      When the admin edits another field and saves
      Then the submitted backfill start is still that same instant

    @unit
    Scenario: A picked date is still normalized to an instant before saving
      When the admin picks a backfill start of "2026-08-01"
      And saves the form
      Then the submitted backfill start is a timezone-carrying instant

  Rule: Which notes the edit drawer owes an admin is decided before it is drawn

    The marker beside the edit title shows whatever the note list holds, so
    what that list holds for a given source is the whole of the behaviour.
    Deciding it in a pure function lets all four combinations be pinned at
    once, rather than one drawer render at a time.

    @unit
    Scenario: A source that has never pulled is owed no note on either report
      Given a source that has not yet pulled
      When the notes for its edit drawer are worked out
      Then there are none, whichever report it is set to
      # Nothing is locked before a cursor exists, and a marker opening onto
      # an empty popover invites a click that answers nothing.

    @unit
    Scenario: A pulled usage source is owed the two notes that lock it
      Given a source on the usage report that has already pulled
      When the notes for its edit drawer are worked out
      Then they are the report note and the start-date note, in that order
      And the note about restating cost history is not among them

    @unit
    Scenario: A pulled cost source is owed the report note and the restate note
      Given a source on the cost report that has already pulled
      When the notes for its edit drawer are worked out
      Then they are the report note and the restate note, in that order
      And the note saying the start date is fixed is not among them
      # On a cost source the start is not fixed: moving it is the lever that
      # repairs the figures, so calling it fixed would be a lie.

    @unit
    Scenario: No source is ever owed all three notes
      When the notes are worked out for every combination of pulled and report
      Then no combination yields more than two
      # A fixed start and a start worth moving are the two halves of one
      # condition, and the report decides which half applies.
