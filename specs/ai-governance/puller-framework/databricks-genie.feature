Feature: Databricks AI/BI Genie puller
  As a governance owner whose analysts query the warehouse in natural language
  I want every Genie question, and the SQL Genie generated from it, recorded
  against the person who asked
  So that I can answer "who asked what of our data, and what ran against it"

  Genie is free per message today, so these records exist for VISIBILITY, not
  for spend. They carry a cost of zero and must never invent one.

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
  Scenario: A question costs nothing and is never priced
    Given a Genie message
    When the puller records it
    Then the recorded cost is zero
    And the cost is not presented as the customer's final invoice
    # Genie itself bills nothing per message; the warehouse compute behind the
    # question is invoiced separately and is not visible on this API.

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
