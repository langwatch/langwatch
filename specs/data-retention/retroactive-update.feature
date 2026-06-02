Feature: Retroactive retention changes
  As a customer
  I want to apply retention changes to my existing data
  So that old data follows the new retention policy

  # Retention values are whole weeks (multiples of 7 days) to align with the
  # weekly partition key.

  Background:
    Given the project has retention set to 49 days for traces
    And the project has 100GB of existing span data across 12 weekly partitions

  Scenario: New data gets new retention immediately
    When the admin changes trace retention from 49 to 91 days
    Then newly ingested spans are stamped with _retention_days = 91
    And existing spans still have _retention_days = 49

  Scenario: Explicit retroactive update applies to existing data
    When the admin adds a retention policy of 91 days with the "Apply this change to existing data" switch enabled
    And confirms in the "Apply retention to existing data?" dialog
    Then a ClickHouse mutation is issued for each trace-category table
    And the mutation updates _retention_days = 91 for this tenant
    And the update applies uniformly to every retention-managed table including event_log

  Scenario: Retroactive update progress is tracked
    When a retroactive update is in progress
    Then the UI shows a progress entry per table from system.mutations
    And the progress shows the parts still pending counting down to zero

  Scenario: Rate-limited to one mutation per tenant per table
    Given a retroactive update is in progress for stored_spans
    When the admin attempts another retroactive update for stored_spans
    Then the request is rejected with a rate-limit error
    And the error indicates the existing mutation must complete first

  Scenario: Conflict error names the mutation IDs callers can kill
    Given retroactive updates are in progress for stored_spans and trace_summaries
    When the admin attempts another retroactive update for the traces category
    Then the conflict error lists the mutation_id and table of every blocking mutation
    And the caller can act on those ids without parsing the message text

  Scenario: Retroactive apply requires confirmation
    When the admin saves a retention policy with the "Apply this change to existing data" switch enabled
    Then a confirmation dialog warns that any rows older than the new retention become eligible for deletion on the next background merge
    And the retroactive update does not proceed until the admin confirms

  Scenario: Saving without retroactive apply leaves existing data untouched
    When the admin saves a retention policy with the "Apply this change to existing data" switch disabled
    Then no confirmation dialog is shown
    And the scope rule is persisted without issuing any ClickHouse mutation
    And only newly ingested rows are stamped with the new _retention_days

  Scenario: Stuck mutation can be killed
    Given a retroactive mutation has been running for over 1 hour
    When the admin clicks "Cancel" on the mutation's row in the retroactive-progress card
    Then the system issues KILL MUTATION for that mutation_id
    And the mutation is stopped
