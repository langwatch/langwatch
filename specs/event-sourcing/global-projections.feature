Feature: Global Projections and Reactors

  Global projections and reactors subscribe to events from all pipelines. They are used for
  cross-pipeline metrics like billable event counts and SDK usage tracking.

  Scenario: Dispatched from any pipeline
    Given a global projection or reaction "projectDailyBillableEvents"
    When an event arrives in the "trace_processing" pipeline
    And the event is stored locally
    Then it is also dispatched to the global projection or reaction registry
    And the "projectDailyBillableEvents" projection or reaction reacts to the event

  Scenario: Independent processing
    Given a global projection or reaction registered in the registry
    When events are dispatched to global projections
    Then they are processed in a dedicated virtual pipeline "global"
    And failures in global projections and reactors do not affect local pipeline processing
