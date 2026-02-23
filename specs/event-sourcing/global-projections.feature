Feature: Global Projections

  Global projections subscribe to events from all pipelines. They are used for
  cross-pipeline metrics like billable event counts and SDK usage tracking.

  Scenario: Dispatched from any pipeline
    Given a global projection "projectDailyBillableEvents"
    When an event arrives in the "trace_processing" pipeline
    And the event is stored locally
    Then it is also dispatched to the global projection registry
    And the "projectDailyBillableEvents" projection reacts to the event

  Scenario: Independent processing
    Given a global projection registered in the registry
    When events are dispatched to global projections
    Then they are processed in a dedicated virtual pipeline "global_projections"
    And failures in global projections do not affect local pipeline processing
