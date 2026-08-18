Feature: Databricks AI/BI Genie puller
  As a governance owner whose analysts query the warehouse in natural language
  I want every Genie question, and the SQL Genie generated from it, recorded
  against the person who asked
  So that I can answer "who asked what of our data, and what ran against it"

  Genie charges nothing per message. The warehouse compute that answers the
  question does, and that spend is billed to the customer whether or not anyone
  attributes it. So a source that names a warehouse gets each question's share
  of that compute; a source that names none carries a cost of zero and must
  never invent one.

  Background:
    Given an IngestionSource of type `databricks_genie`
    And a workspace token in `pullConfig.credentials.token`

  @integration
  Scenario: One record per question, carrying the question and the SQL
    Given a Genie space with a conversation containing one message
    And the message generated a SQL query against the warehouse
    When the puller runs
    Then one activity record is written for that message
    And the record carries the question as the user typed it
    And the record carries the generated SQL
    And the record names the space the question was asked in

  @integration
  Scenario: Every user's activity is captured, not just the caller's
    Given the workspace has conversations started by several different people
    When the puller lists conversations
    Then it asks for all users' conversations
    And the records cover every person who asked a question
    # Without this the workspace's activity silently collapses to the service
    # account's own, and nothing anywhere reports a failure.

  @integration
  Scenario: A question costs nothing when no warehouse is named
    Given a Genie source configured without a warehouse
    When the puller records a message
    Then the recorded cost is zero
    And the puller does not ask the workspace about billing
    # Genie itself bills nothing per message. Naming the warehouse is what
    # opts a source into attributing the compute behind the question.

  Rule: A named warehouse turns each question's share of compute into cost

    Databricks does not price a Genie question. It bills the warehouse for the
    hours it was awake, and reports the SQL each question ran. The share is
    ours to compute, so every scenario here is about not overstating it.

    @integration
    Scenario: The compute behind a question is charged to the person who asked
      Given a Genie source that names the warehouse answering its questions
      And a message whose generated SQL ran on that warehouse
      When the puller records it
      Then the record carries a cost above zero
      And the cost is attributed to the person who asked the question
      And the cost is marked an estimate

    @integration
    Scenario: An hour's compute is split across the questions that used it
      Given a warehouse billed for one hour of compute
      And two questions ran in that hour, one taking twice as long as the other
      When the puller records them
      Then the longer question carries twice the cost of the shorter
      And together they carry no more than the hour's billed compute
      # The warehouse is billed for being awake, not per query. Anything that
      # hands every query the whole hour reports the bill once per question.

    @integration
    Scenario: Other traffic on the warehouse keeps its share of the bill
      Given a warehouse billed for one hour of compute
      And half that hour was spent on queries no Genie question asked for
      When the puller prices the Genie questions in that hour
      Then they carry at most half the hour's billed compute
      And the rest is left unattributed
      # Dividing the hour across Genie's queries alone hands Genie the whole
      # warehouse bill, including the dashboards and jobs sharing it.

    @integration
    Scenario: The puller's own billing query is not charged to a question
      Given the puller asks the warehouse for its billing
      When that query appears in the warehouse's own history
      Then no question is charged for it

    @integration
    Scenario: Genie's own free usage is never charged
      Given the workspace bills a free-usage line for Genie alongside the warehouse
      When the puller prices a question
      Then only the warehouse compute is counted
      And the free-usage line adds nothing

    @integration
    Scenario: A question whose SQL has not reached the billing tables yet
      Given a message whose generated SQL is too recent to appear in query history
      When the puller records it
      Then the record carries a cost of zero
      And the message is recorded for visibility regardless

    @integration
    Scenario: Cost that arrives late corrects the record rather than adding one
      Given a message first recorded before its compute was billed
      When a later run reads it again and the compute is now billed
      Then the message still appears once
      And the cost it carries is the billed one
      # Same question, same coordinates, so the same record. A second row here
      # would double the reported spend of every question near the boundary.

    @integration
    Scenario: A source that prices its questions keeps looking back far enough
      Given a Genie source that names a warehouse
      When a run finishes
      Then the next run still reads the questions whose compute could have been billed since
      # Databricks publishes a query's compute well after the query. A source
      # that stops looking at a question five minutes after it was asked can
      # never learn what it cost, and every question would sit at zero forever.

    @integration
    Scenario: A source that prices nothing does not widen its window
      Given a Genie source configured without a warehouse
      When a run finishes
      Then the next run reads only the questions asked since the last one
      # The look-back is bought with requests against the workspace. Only a
      # source that has something to learn from it should pay.

    @integration
    Scenario: A question that ran no SQL is charged nothing
      Given a message Genie answered without running a query
      When the puller records it
      Then the recorded cost is zero

    @integration
    Scenario: A priced question calls its figure an estimate
      Given a workspace whose account may have a discount off the published rate
      When the puller prices a question
      Then the figure is marked an estimate
      # The account's negotiated discount is on no table this token can read, so
      # the figure can only ever come from the published rate. Saying so is the
      # whole difference between a useful number and one somebody reconciles
      # against a bill and finds wrong.
      #
      # That the arithmetic reaches for the published rate rather than any other
      # price lives in the SQL, and no test executes the SQL — replacing the
      # whole statement with nonsense leaves every test green. This scenario
      # therefore claims only what is observed: the label. See langwatch-saas#1116.

    @integration
    Scenario: A cost answer that was cut short prices nothing
      Given a warehouse busy enough to fill the cost query's row limit
      When the puller reads the cost
      Then no question is priced from that answer
      # Which statements the answer left out is exactly what it cannot tell us.
      # Pricing the ones that arrived would put a confident zero on the rest,
      # and on a first sweep that zero is permanent: the cursor moves past the
      # question and later runs only re-read the settling window.

    @integration
    Scenario: Compute the workspace prices in another currency is not converted
      Given the warehouse's billed compute is priced in a currency other than USD
      When the puller prices a question
      Then no cost is recorded for it
      And the run reports why
      # A guessed conversion rate is a number nobody can reconcile against the
      # invoice, and it would look exactly like a real one.

    @integration
    Scenario: Compute the workspace has no published price for is not guessed
      Given the warehouse's billed compute has no published price
      When the puller prices a question
      Then no cost is recorded for it
      And the message is still recorded for visibility

    @integration
    Scenario: A billing outage never rewrites a cost that was already worked out
      Given a question whose compute has already been priced
      When a later run reads it again and the workspace refuses the billing query
      Then the question keeps the cost it was already given
      # The re-read exists only to learn a cost. A run that learned none has
      # nothing to say about this question, and saying "zero" would erase the
      # answer an earlier run got right — a few minutes of billing trouble would
      # quietly wipe the spend it could not confirm.

    @integration
    Scenario: Billing answered in a shape we did not ask for is not priced from
      Given the workspace answers the billing question with different columns
      When the puller reads the answer
      Then no cost is recorded from it
      And the questions are still recorded
      # Every value in that answer is text, so the wrong columns parse just as
      # cleanly as the right ones and price each question off whichever number
      # happened to land in that position.

    @integration
    Scenario: A question's hour is priced whole or not at all
      Given a run whose window begins part-way through an hour
      When the puller prices the questions asked in that hour
      Then that hour's compute is either counted in full or not counted
      # The bill is published per hour and the queries are recorded per hour. A
      # window cutting an hour in half keeps its queries and loses its bill, so
      # every question in it prices at nothing while looking properly priced.

    @integration
    Scenario: A billing outage does not discard the questions
      Given the workspace refuses the billing query
      When the puller runs
      Then the messages are still recorded
      And the failure is reported
      And the watermark stays where it was
      # Visibility is the floor. Losing a run's activity because its cost could
      # not be worked out trades the thing that always works for the one that
      # sometimes does.

    @integration
    Scenario: A fraction of a cent survives the record
      Given a question whose share of compute is a small fraction of a cent
      When the puller records it
      Then the cost is kept at full precision
      And it is not rounded to zero
      # A per-question share of an hourly bill is routinely sub-cent. Rounding
      # at the record makes a busy workspace report nothing at all.

    @unit
    Scenario: The billing query only ever runs on the configured workspace
      Given a Genie source that names a warehouse
      When the puller asks for billing
      Then the question is sent to the workspace address on the source
      # Same secret, same reasoning as every other call this adapter makes: the
      # address on the source decides where the token goes.

  @integration
  Scenario: Identity resolves to the directory's object id when it has one
    Given the author's directory entry has an external object id
    When the puller resolves the author
    Then the record is keyed on that object id

  @integration
  Scenario: Identity falls back to the login when there is no object id
    Given the author's directory entry has no external object id
    When the puller resolves the author
    Then the record is keyed on the author's login
    And the record is still attributed to that person

  @integration
  Scenario: An author the directory no longer has is looked up once
    Given a message whose author has been deleted from the directory
    When the puller reads many messages by that author
    Then the directory is asked about that author only once
    And every message is still recorded, unattributed

  @integration
  Scenario: A directory outage does not strip authors off the rest of the run
    Given the directory fails temporarily while resolving one author
    When the puller reads a later message by the same author
    Then it asks the directory again rather than reusing the failure

  @integration
  Scenario: Every page of every list is read
    Given a space whose conversations span more than one page
    When the puller runs
    Then messages from every page are recorded

  @integration
  Scenario: Pagination that does not advance is refused
    Given a list endpoint that returns the same page token it was given
    When the puller reads it
    Then the run reports a failure
    And the watermark does not move
    # Following it would burn the whole run re-reading one page and then look
    # indistinguishable from a workspace that is simply large.

  @integration
  Scenario: One unreadable space does not discard the others
    Given a workspace with several spaces
    And the token cannot read one of them
    When the puller runs
    Then the messages from the readable spaces are still recorded
    And the failure is reported

  @integration
  Scenario: The watermark never moves past data that was not fetched
    Given a sweep that could not read one space
    When the run finishes
    Then the watermark stays where it was
    And the next run reads that space's history again

  @integration
  Scenario: A sweep cut short by its budget resumes where it stopped
    Given a workspace with more spaces than one run may read
    When the run reaches its request budget
    Then the records it already read are kept
    And the watermark stays where it was
    And the next run starts at the space it stopped on

  @integration
  Scenario: Activity during a sweep is caught by the next one
    Given a sweep that reads several spaces in turn
    And someone asks a question in an already-read space while it runs
    When the next run happens
    Then that question is recorded
    # The watermark is anchored to when the sweep BEGAN, not to the newest
    # message it happened to see.

  @integration
  Scenario: A re-read message is recorded once
    Given a message that falls inside two consecutive runs' windows
    When both runs record it
    Then it appears once in the activity records
    And it moves no money

  @integration
  Scenario: The workspace token is never stored in plain text
    Given an admin configures a Genie source through the governance UI
    When the source is saved
    Then the token is held encrypted
    And the token is not readable from the source's configuration

  @unit
  Scenario: The token may only be sent to a Databricks workspace
    Given a Genie source whose workspace address is not a Databricks one
    When someone saves it
    Then the save is refused
    And the reason names the addresses that are allowed
    # The worker attaches the stored token to every request it sends to this
    # address, so whoever sets it decides where the secret goes. Checked when
    # it is saved, because by the time a run uses it the person is long gone.

  @unit
  Scenario: A secret cannot be kept while the destination is changed
    Given a source that already holds a workspace token
    When someone saves it with the stored secret sent back verbatim
    Then the save is refused
    And the stored secret is unchanged
    # Otherwise a caller who cannot read the secret could still keep it while
    # pointing the source at an address of their choosing.

  @unit
  Scenario: Saving an unrelated change keeps the secret and the rotation window
    Given a source that already holds a workspace token
    And a rotation of its ingest secret is still inside its grace window
    When someone renames the source without re-entering the token
    Then the stored token is unchanged
    And the rotation grace window is unchanged
    # A client is never shown either of them, so it cannot send them back, and
    # absent has to mean unchanged rather than cleared.
