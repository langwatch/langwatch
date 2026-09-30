Feature: Trace automations are authored in LWQL and matched in memory

  Rule: A condition maps back to the in-memory matcher when it is saved
    Scenario: A supported expression is saved with its derived query
      Given a member who may manage automations in project "p1"
      When they save a trace automation with condition "ContainsErrorStatus AND TotalCost > 0.1"
      Then the automation stores that LWQL text
      And it stores the equivalent trace query for the matcher

    Scenario: A condition that does not parse is refused with its position
      When they save condition "TotalCost > AND"
      Then the save is refused with trigger_condition_invalid
      And the refusal names line 1 and the column of "AND"

    Scenario: A condition that does not map back is saved as windowed
      Given LWQL is available to project "p1"
      When they save condition "TraceId IN (SELECT TraceId FROM evaluations WHERE Passed = 0)"
      Then the automation is saved with no derived trace query
      And it is evaluated on the windowed schedule

    Scenario: A windowed condition needs LWQL
      Given the project is outside the Workbench rollout
      When they save condition "lower(TraceName) = 'x'"
      Then the save is refused with lwql_unavailable

    Scenario: A condition the policy refuses is refused with its violations
      When they save condition "TraceId IN (SELECT 1 FROM url('http://x'))"
      Then the save is refused with trigger_condition_invalid
      And the refusal carries the policy's violations

    Scenario: An aggregate is a metric, not a trace condition
      When they type condition "count() > 10" in the trace editor
      Then the check answers trigger_condition_is_metric
      And the editor offers to switch the subject to a metric alert

    Scenario: The builder and the editor produce the same stored condition
      Given the builder rows "status is error" and "cost greater than 0.1"
      When the builder emits its LWQL
      Then saving it stores the same derived query as the rows did

    Scenario: Reopening a saved condition restores the builder rows
      Given an automation saved from builder rows
      When the drawer is opened
      Then the builder shows the same rows

  Rule: Evaluation stays in memory
    Scenario: A matching trace fires without a ClickHouse query
      Given an active automation whose condition is "ContainsErrorStatus"
      When an errored trace settles
      Then the automation delivers once
      And no LWQL statement was run

  Rule: Trace conditions work where LWQL is unavailable
    Scenario: The builder saves a condition on an install without LWQL
      Given the deployment has no LWQL identity
      When a member saves builder rows "status is error"
      Then the automation is saved and fires on errored traces

    Scenario: The LWQL editor is not offered without LWQL
      Given the deployment has no LWQL identity
      When a member opens the trace subject
      Then only the builder is offered

  Rule: Stored conditions move to LWQL in place
    Scenario: A trace query row gains its LWQL text and matches the same traces
      Given an automation with filterQuery "status:error"
      When the organization's lwql-conditions pass runs
      Then the automation carries the equivalent LWQL text
      And the same trace fixtures match before and after

    Scenario: An untranslatable legacy row keeps firing and is reported
      Given an automation whose legacy filters select an evaluator result
      When the pass runs
      Then the automation keeps its legacy condition and keeps firing
      And the migration report names it and the field

    Scenario: The pass is idempotent
      When the pass runs twice
      Then the second run writes nothing and finalizes

  Rule: The public API keeps its callers during the window
    Scenario: A REST create with lwql stores both forms
      When a client POSTs /api/triggers with lwql "ContainsErrorStatus"
      Then the trigger carries the LWQL text and the derived query

    Scenario: A REST create with filterQuery still works
      When a client POSTs /api/triggers with filterQuery "status:error"
      Then the trigger fires on errored traces
      And a read returns the LWQL text beside the filterQuery

    Scenario: A REST filterQuery that does not compile is refused
      When a client POSTs filterQuery "status:("
      Then the request is refused with trigger_filter_query_invalid
