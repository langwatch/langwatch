Feature: Retroactive retention changes
  As a customer
  I want to apply retention changes to my existing data
  So that old data follows the new retention policy

  Background:
    Given the project has retention set to 30 days for traces
    And the project has 100GB of existing span data across 12 weekly partitions

  Scenario: New data gets new retention immediately
    When the admin changes trace retention from 30 to 90 days
    Then newly ingested spans are stamped with _retention_days = 90
    And existing spans still have _retention_days = 30

  Scenario: Explicit retroactive update applies to existing data
    When the admin changes trace retention to 90 days
    And clicks "Apply to existing data"
    Then a ClickHouse mutation is issued for each trace-category table
    And the mutation updates _retention_days = 90 for this tenant
    And the update applies uniformly to every retention-managed table including event_log

  Scenario: Retroactive update progress is tracked
    When a retroactive update is in progress
    Then the UI shows a progress bar from system.mutations
    And the progress reflects parts_done / (parts_done + parts_to_do)

  Scenario: Rate-limited to one mutation per tenant per table
    Given a retroactive update is in progress for stored_spans
    When the admin attempts another retroactive update for stored_spans
    Then the request is rejected with a rate-limit error
    And the error indicates the existing mutation must complete first

  Scenario: Contraction requires confirmation
    Given trace retention is currently 90 days
    When the admin changes retention to 30 days
    Then a confirmation dialog warns that data between 30-90 days old will be eligible for deletion
    And the retroactive update does not proceed until confirmed

  Scenario: Expansion is safe and requires no confirmation
    Given trace retention is currently 30 days
    When the admin changes retention to 90 days
    Then no confirmation dialog is shown
    And the change is applied immediately

  Scenario: Stuck mutation can be killed
    Given a retroactive mutation has been running for over 1 hour
    When the admin clicks "Cancel mutation"
    Then the system issues KILL MUTATION for that mutation_id
    And the mutation is stopped
