Feature: Existing billable events get the 13-month retention
  As the owner of the billable-events meter
  I want parts written before goose 00128 to apply its delete TTL
  So that rows older than 13 months leave the table everywhere, not only after a later merge

  Goose 00128 adds the TTL as metadata only (materialize_ttl_after_modify = 0). The background
  step `entitlement:materialise-billable-events-ttl` starts one `MATERIALIZE TTL` on the worker
  and waits on it, so its progress and failure reach the upgrade ledger.

  @unit @usage
  Scenario: The step starts the TTL materialisation once and waits for it to finish
    Given no TTL materialisation is listed for billable_events
    When the step runs
    Then it saves its checkpoint before starting one materialisation
    And it reports done once ClickHouse lists that materialisation as finished

  @unit @usage
  Scenario: A resumed step never starts a second materialisation
    Given an earlier run saved that ClickHouse accepted the materialisation
    And ClickHouse lists none any more
    When the step runs again
    Then it reports done with no parts left, without starting another

  @unit @usage
  Scenario: A step stopped around the start issues the materialisation again
    Given an earlier run saved that it was starting the materialisation
    But the start failed before ClickHouse accepted it
    And ClickHouse lists none
    When the step runs again
    Then it starts the materialisation, which is safe to repeat, instead of reporting done

  @unit @usage
  Scenario: A materialisation the step finds running counts as started
    Given an operator already started a TTL materialisation that is still running
    When the step runs
    Then it saves that the materialisation was accepted before it waits
    And once ClickHouse lists none any more it reports done without starting another

  @unit @usage
  Scenario: A dry run starts nothing
    Given no TTL materialisation is listed for billable_events
    When the step runs as a dry run
    Then nothing is started and no checkpoint is saved

  @unit @usage
  Scenario: A failed materialisation fails the step with its reason
    Given ClickHouse lists the materialisation with a failure reason
    When the step runs
    Then the step fails naming the mutation and the reason, so an operator can fix and retry it
