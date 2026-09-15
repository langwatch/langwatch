Feature: Edit the configuration of a pull-mode ingestion source
  As an organization admin
  I want to correct a pull source's credential, cadence and adapter settings
  So that a mistyped key or a wrong schedule does not force me to archive and
  recreate the source, losing its poller cursor and re-backfilling history

  Background:
    Given an organization with the ingestionSources:manage permission
    And a pull-mode ingestion source of type anthropic_admin on the usage report
    And the source has a stored upstream credential

  Rule: A stored secret is never shown, and never has to be re-typed

    @unit
    Scenario: The edit form opens with the secret field empty
      When the admin opens the edit form for the source
      Then the adapter configuration fields are shown
      And the admin API key field is empty
      And the field explains that leaving it blank keeps the current key

    @unit
    Scenario: Saving without touching the secret keeps the existing credential
      When the admin changes only the display name
      And saves the form
      Then the submitted configuration carries no credentials key at all
      And the stored upstream credential is unchanged

    @unit
    Scenario: Entering a new secret replaces the stored one
      When the admin enters a new admin API key
      And saves the form
      Then the submitted configuration carries the new key
      And the stored credential is replaced with an encrypted envelope

    @unit
    Scenario: A stored envelope is never sent back to the server
      When the admin saves the form without changing anything
      Then the submitted configuration carries no encrypted envelope
      And the save is not rejected as a replayed credential

  Rule: Adapter settings are validated before they reach the database

    @unit
    Scenario: A date read from history is normalized before saving
      When the admin picks a "Read history from" date of "2026-08-01"
      And saves the form
      Then the stored start is a timezone-carrying instant

    # The adapter reads usage in daily buckets and prices cost in daily
    # buckets, so a width is a question with one answer. Asking it only gave
    # an admin a way to answer it wrongly and have the save refused.

    @unit
    Scenario: The bucket width is decided for the admin, not asked of them
      When the admin opens the edit form
      Then no bucket width field is shown
      And saving a usage source stores a bucket width of "1d"

    @unit
    Scenario: An invalid cron expression is rejected at save time
      When the admin enters a pull schedule of "not a cron"
      And saves the form
      Then the save is refused
      And the source configuration is left unchanged

  Rule: A setting that can no longer take effect is not offered as editable

    # The usage cursor deliberately never rewinds, so a start date edited
    # after the first successful run is accepted and then ignored. An input
    # that silently does nothing is worse than no input. The cost cursor is a
    # different animal: it binds the start into its own identity, so moving
    # the start there is the deliberate lever for repairing wrong figures and
    # locking it would hide the only repair an admin has.

    @unit
    Scenario: Backfill start is editable before the source has run
      Given the source has not yet completed a pull
      When the admin opens the edit form
      Then the backfill start is editable

    @unit
    Scenario: Backfill start is not editable once a usage cursor has moved
      Given the source has completed at least one pull
      And the source is configured for the usage report
      When the admin opens the edit form
      Then the backfill start is shown but cannot be changed

    @unit
    Scenario: Backfill start stays editable on a cost source that has pulled
      Given the source has completed at least one pull
      And the source is configured for the cost report
      When the admin opens the edit form
      Then the backfill start is still editable
      And the marker says moving it re-reads and restates cost history

    # Claiming an immutability we cannot justify is the worse error.
    @unit
    Scenario: A source whose stored configuration names no report is not locked
      Given the source has completed at least one pull
      And the stored configuration carries no report
      When the admin opens the edit form
      Then no adapter field is locked

    # The explanation sits behind that marker rather than as a paragraph under
    # the fields, where three of them pushed the fields below the fold. See
    # dev/docs/best_practices/copywriting.md.
    Scenario: A locked backfill start says why it is locked
      Given the source has completed at least one pull
      And the source is configured for the usage report
      When the admin opens the edit form
      Then the drawer title carries an information marker explaining why
      And the marker says the cursor has already moved past it

  Rule: The report kind is fixed once a source has pulled

    # The adapter's two reports price the same spend twice over, and its own
    # header states the rule as "Never both". A changed report no longer
    # matches the stored cursor, so the new report replays from the configured
    # start and its events land beside the old ones under different ids —
    # nothing collides, nothing complains, and the same money is counted twice.

    @unit
    Scenario: The report cannot be changed once a cursor exists
      Given the source has completed at least one pull
      When the admin submits a change of report
      Then the save is refused
      And the form locks the report rather than offering a save the server refuses

    @unit
    Scenario: A source that starts pulling mid-save does not lose the rule
      Given the source has not yet completed a pull
      And the admin submits a change of report
      When a pull run records a cursor before the change is written
      Then the save is refused rather than applied
      And the source keeps the report and the cursor the pull run left it with

  Rule: Copy that does not apply to a pull source is not shown

    # Hiding the rotate control itself for pull sources is an access decision,
    # not a form-editing one, and is deliberately not made here: the control
    # stays where it is for every source type. What this rule covers is the
    # drawer no longer telling a pull-source admin about an ingest secret
    # their source does not have.

    Scenario: A pull-mode source is not told its ingest secret is immutable
      When the admin opens the edit form for a pull-mode source
      Then the form does not describe the ingest secret as immutable
      And the form still explains that the source type is immutable

    Scenario: A push-mode source is told both are immutable
      Given a push-mode ingestion source
      When the admin opens the edit form for that source
      Then the form describes the ingest secret as immutable
      And the form points at the rotate control for changing it

  Rule: The source detail page can edit, not only the source list

    Scenario: Editing is reachable from the detail page
      When the admin opens the source detail page
      Then an edit control is offered
      And it opens the same configuration form as the source list

    Scenario: A viewer without manage permission cannot edit
      Given an admin holding only the ingestionSources:view permission
      When they open the source detail page
      Then no edit control is offered
