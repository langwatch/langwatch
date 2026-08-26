Feature: OpenAI Admin cost puller
  As a governance owner paying an OpenAI organization bill
  I want each day's spend recorded against the person and the credential it
  was billed to
  So that I can answer "who is spending this, and on which key"

  OpenAI reports spend as one bucket per day, holding rows already grouped by
  project, line item, person and API key. The person is on the row, so nothing
  here asks a directory who anyone is. The money is the provider's own dollars,
  and the whole risk of this feature is a number that looks right and is not.

  Background:
    Given an IngestionSource of type `openai_admin`
    And an organization Admin API key in `pullConfig.credentials.token`

  Rule: The provider's figure survives the trip unchanged

    Everything here is one claim restated: the number recorded is the number
    the provider sent. The sibling adapter for another provider reports cents
    and shifts the decimal to reach dollars; doing that here would report a
    hundred times the real spend, and it would look entirely ordinary.

    @integration
    Scenario: A day's spend is recorded as the dollars the provider reported
      Given a day the provider bills a known amount for
      When the puller runs
      Then the recorded spend equals that amount to the digit
      And it is recorded in US dollars

    @unit
    Scenario: A fraction of a cent survives the record
      Given a day whose spend is a small fraction of a cent
      When the puller records it
      Then every digit the provider sent is kept
      And it is not rounded to zero
      # Per-person, per-key, per-line-item rows are routinely sub-cent. Rounding
      # at the record makes a busy organization report almost nothing.

    @unit
    Scenario: Spend is called an estimate, not the invoice
      Given a day the provider bills an amount for
      When the puller records it
      Then the figure is marked an estimate
      And it is marked as the provider's own number
      # Nothing establishes that this report equals the bill, and the provider's
      # own usage surface already disagrees with its cost surface. Saying
      # "estimate" is the difference between a useful number and one somebody
      # reconciles against an invoice and finds wrong.

  Rule: A read that learned no cost never overwrites one

    @integration
    Scenario: A day whose spend has vanished keeps the figure it had
      Given a day already recorded with spend against a person
      When a later run reads that day and the provider no longer reports it
      Then the day keeps the spend it was already given
      And no zero is recorded for it
      # A re-read exists only to learn a cost. Writing zero from a run that
      # learned none erases a confirmed figure, because the newer write wins.

    @integration
    Scenario: A day with no spend at all is still read past
      Given a day the organization spent nothing on
      When the puller runs
      Then no spend is recorded for that day
      And the source still moves on to the following days
      # A quiet day must not look like the end of the data, or a source goes
      # permanently silent after a weekend.

  Rule: A day the provider corrects is corrected here

    @integration
    Scenario: A corrected day replaces its earlier figure rather than adding one
      Given a day already recorded with spend
      When a later run reads that day and the provider now reports a different amount
      Then the day appears once
      And the spend it carries is the newer amount

    @integration
    Scenario: The source keeps looking back far enough to see a correction
      Given a run that has read up to the most recent day
      When the next run starts
      Then it reads the last few days again rather than only the new ones
      # A provider correction arrives after the day it belongs to. A source that
      # never looks back cannot see one, and nothing downstream reconciles these
      # figures against anything, so a wrong number would be corrected by nobody
      # and noticed by nothing.

    @integration
    Scenario: Re-reading an unchanged day records nothing new
      Given a day already recorded with spend
      When a later run reads that day and the provider reports the same amount
      Then the day still appears once
      And the recorded spend is unchanged

    @unit
    Scenario: Looking back never rewinds the source's progress
      Given a run that has read up to the most recent day
      When a later run reads an older window and the provider answers with older days
      Then the source's position does not move backwards
      # The look-back window is measured from today, so every run asks about days
      # it has already passed. A position taken from whatever arrived last would
      # walk the source backwards a few days on every run and never finish.

  Rule: History older than the provider's key breakdown keeps its person

    The provider refuses to break spend down by API key before a cutoff date it
    names when it refuses. Everything before that date is still billed, still
    real, and still attributable to a person.

    @integration
    Scenario: Older spend is still recorded and still names the person
      Given a window beginning before the provider's key-breakdown cutoff
      When the puller runs
      Then that window's spend is recorded
      And it names the person it was billed to

    @unit
    Scenario: Older spend says nothing about which key was used
      Given a window beginning before the provider's key-breakdown cutoff
      When the puller records that window's spend
      Then no API key is claimed for it
      # Absent is the honest answer. Attributing that spend to any key would put
      # a confident wrong name on months of history.

    @unit
    Scenario: A refusal about anything else is not mistaken for the cutoff
      Given the provider refuses a request for a reason unrelated to the cutoff
      When the puller reads the response
      Then it does not retry without the key breakdown
      And the run reports the failure
      # The two refusals arrive as the same shape. Reading them as one would drop
      # a breakdown the provider was perfectly willing to give, silently and for
      # good.

  Rule: Identity rides the record as the provider wrote it

    @integration
    Scenario: Spend is attributed to the person the provider named
      Given a day whose spend the provider attributes to a person
      When the puller records it
      Then the record names that person by the email the provider gave
      And the record carries the provider's own id for that person

    @integration
    Scenario: The credential the spend was billed to is recorded
      Given a day whose spend the provider attributes to an API key
      When the puller records it
      Then the record carries that key's id

    @integration
    Scenario: Spend billed to a deleted key is still recorded against it
      Given a day whose spend was billed to an API key that no longer exists
      When the puller records it
      Then the record still carries that key's id
      # A large share of an organization's spend routinely sits on keys someone
      # has since deleted. The id outlives the key and is the only thing left to
      # join on.

    @unit
    Scenario: Nobody is looked up while pulling
      Given a day whose spend the provider attributes to a person
      When the puller records it
      Then no directory or user list is asked about that person
      # The identity is already on the row. Resolving it here would bake a
      # snapshot of who someone was into a record that can never be rewritten.

  Rule: A run that could not finish does not report as if it did

    @integration
    Scenario: A failed read leaves the source where it was
      Given a run whose request to the provider fails
      When the run ends
      Then the source's position is unchanged
      And the failure is reported
      And the next run reads that window again

    @integration
    Scenario: Every page of a window is read
      Given a window spanning more days than one page can carry
      When the puller runs
      Then the spend from every page is recorded

    @unit
    Scenario: A page token is never replayed under a changed question
      Given a source part-way through reading a window
      When its configuration is changed so it would ask a different question
      Then the stored page token is discarded
      And the source starts the new question from the beginning
      # The provider binds a page token to the exact question that produced it
      # and refuses it under any other, so a replayed token fails the run rather
      # than returning the wrong page.

    @integration
    Scenario: Widening the backfill start makes the source read the older days
      Given a source that has already read up to the most recent day
      When an admin moves its start date earlier
      Then the next run reads from the earlier date
      # This is the operator's only lever for a correction that arrived too late
      # to be seen, so it has to actually work.

  Rule: The same spend is never counted twice

    @unit
    Scenario: Only the cost report is read
      Given a running `openai_admin` source
      When a run finishes
      Then the provider's usage reports were not read
      # The cost report already carries the identity and real dollars. Reading
      # both surfaces records the same spend twice, and they disagree with each
      # other besides.

    @integration
    Scenario: Adding a second source for the same organization warns the admin
      Given an organization that already has an `openai_admin` source
      When an admin begins configuring another one
      Then the form warns that the spend would be counted twice
      # Not refused: the same exposure exists on every provider adapter, and a
      # guard built only here would hide it everywhere else.

  Rule: The credential is handled like a credential

    @integration
    Scenario: The Admin API key is never stored in plain text
      Given an admin configures an `openai_admin` source
      When the source is saved
      Then the key is held encrypted
      And the key is not readable from the source's configuration

    @unit
    Scenario: A refused key does not put the key in the reason
      Given a source whose Admin API key the provider rejects
      When a run starts
      Then the run fails
      And the recorded reason does not contain the key
      # The reason is logged and shown on the source, so anything it carries is
      # readable by people who were never given the credential.

  Rule: The source that never worked is retired without disappearing

    @unit
    Scenario: The old OpenAI source is still listed and cannot be chosen
      Given an admin opens the list of source types to add
      Then the earlier OpenAI compliance source is still shown
      And it is marked as retired
      And it cannot be selected for a new source
      # Removing it from the list would contradict the promise that the menu
      # shows every supported type. Showing it retired tells the truth to anyone
      # who went looking for it.
