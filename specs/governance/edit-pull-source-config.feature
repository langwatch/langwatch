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
    Scenario: A pull configuration its adapter would refuse is refused at save time
      Given a pull source whose adapter has a configuration schema
      When a create or an update submits a configuration that schema refuses
      Then the save is refused before it is stored
      And the refusal names the field the adapter refused
      # The adapter checked its configuration only when it pulled, so a value
      # the form let through was stored and then failed every scheduled run,
      # with the source still reporting it was waiting for its first event.

    @integration
    Scenario: A Databricks Genie configuration its adapter refuses is not stored
      Given an admin creating a Databricks Genie source
      When its "Read history from" value is a bare date the adapter's schema refuses
      Then the save is refused and names the "Read history from" field
      And no source is stored

    @unit
    Scenario: An adapter name that is not registered is never read as one
      Given a configuration whose adapter is named "constructor"
      When it is checked against the adapters' schemas
      Then no schema is applied and nothing is refused on that account

    @unit
    Scenario: A stored configuration its adapter refuses is reported on the source
      Given a pull source stored before its adapter's schema was checked at save time
      And its configuration is one that schema refuses
      When an admin reads the source
      Then the source carries what the adapter refuses about it

    @integration
    Scenario: A source holding a configuration its adapter refuses says to fix the connection
      Given a pull source whose stored configuration its adapter refuses
      And its last pull failed
      When the admin opens the source
      Then the page names what the adapter refuses
      And tells the admin to fix the connection with Edit
      And does not say the next scheduled pull will retry
      # Retrying a configuration the adapter refuses fails the same way every
      # time, so "the next scheduled pull will retry" left the admin waiting on
      # a fix only they could make.

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
    @integration
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

  Rule: A Copilot Studio source's connection can be corrected after create

    # Before this the edit drawer offered only the name, description and
    # destination, so a mistyped environment address meant archiving the
    # source and typing the whole app registration again (#9275).

    @unit
    Scenario: The edit form opens on the stored connection
      Given a Copilot Studio source
      When the admin opens the edit form
      Then the environment address is shown as stored
      And the agent list, seat and directory switches show their stored values
      And the tenant ID, client ID and client secret fields are empty

    @unit
    Scenario: Leaving the app registration blank keeps it
      Given a Copilot Studio source
      When the admin corrects only the environment address
      And saves the form
      Then the submitted configuration carries no credentials key at all

    @unit
    Scenario: Replacing the app registration takes all three values
      Given a Copilot Studio source
      When the admin enters a new client secret but leaves the tenant ID empty
      And saves the form
      Then the save is refused before it is sent
      And the refusal says all three values are needed together

    @unit
    Scenario: The environment is fixed once the source has pulled
      Given a Copilot Studio source that has completed at least one pull
      When the admin submits a different environment address
      Then the save is refused
      And the form shows the environment address read-only and says why
      # Its cursor belongs to the environment it read. Pointed elsewhere, the
      # next run would carry on from a position in another environment's
      # history and quietly skip whatever came before it there.

    @unit
    Scenario: A source that has pulled can still have its address respelled
      Given a Copilot Studio source that has completed at least one pull
      When the admin submits the same environment with a trailing slash
      Then the save is accepted

    @unit
    Scenario: An update that omits the environment address of a pulled source is told to carry it
      Given a Copilot Studio source that has completed at least one pull
      When an update replaces the configuration without an environment address
      Then the save is refused
      And the refusal says the configuration has to carry the same environment address

    @unit
    Scenario: A Copilot Studio source cannot be created without its app registration
      Given a Copilot Studio configuration with a valid environment address
      When it is created without a tenant ID, client ID or client secret
      Then the save is refused before it is stored
      And the refusal names the missing parts of the app registration

    @unit
    Scenario: A replacement app registration is checked as a whole
      Given a Copilot Studio source
      When an update sends credentials without a client secret
      Then the save is refused before it is stored
      And an update that sends no credentials at all keeps the stored ones

    @unit
    Scenario: A billing app registration typed without the main one is refused
      Given a Copilot Studio source that reads its bill with its own app registration
      When the admin enters a billing client ID and secret but leaves the tenant ID, client ID and client secret empty
      And saves the form
      Then the save is refused before it is sent
      And the refusal names the billing fields

    @integration
    Scenario: The edit drawer shows the stored connection with its secrets blank
      Given a Copilot Studio source that has completed at least one pull
      When the admin opens the edit drawer
      Then the environment address, tenant ID, client ID and client secret fields are shown
      And the three secret fields are empty and say they are replaced together
      And the environment address is read-only, with a note saying why

    @integration
    Scenario: The Copilot Studio edit drawer moves the destination alongside the cadence
      Given a Copilot Studio source that lands its conversations in one project
      When the admin opens the edit drawer's Advanced group
      Then the pull cadence and the destination picker are shown in that one group
      And picking another project and saving carries that project in the update

  Rule: Copy that does not apply to a pull source is not shown

    # Hiding the rotate control itself for pull sources is an access decision,
    # not a form-editing one, and is deliberately not made here: the control
    # stays where it is for every source type. What this rule covers is the
    # drawer no longer telling a pull-source admin about an ingest secret
    # their source does not have.

    @integration
    Scenario: A pull-mode source is not told its ingest secret is immutable
      When the admin opens the edit form for a pull-mode source
      Then the form does not describe the ingest secret as immutable
      And the form still explains that the source type is immutable

    @integration
    Scenario: A custom HTTP pull source is not pointed at a rotate control it does not have
      When the admin opens the edit form for a custom HTTP pull source
      Then the form does not mention rotating the secret
      And the form still explains that the source type is immutable

    @integration
    Scenario: A push-mode source is told both are immutable
      Given a push-mode ingestion source
      When the admin opens the edit form for that source
      Then the form describes the ingest secret as immutable
      And the form points at the rotate control for changing it

  Rule: The source detail page can edit, not only the source list

    @integration
    Scenario: Editing is reachable from the detail page
      When the admin opens the source detail page
      Then an edit control is offered
      And it opens the same configuration form as the source list

    @integration
    Scenario: A viewer without manage permission cannot edit
      Given an admin holding only the ingestionSources:view permission
      When they open the source detail page
      Then no edit control is offered
