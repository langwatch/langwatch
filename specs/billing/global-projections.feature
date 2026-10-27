Feature: Global Projections and Subscribers

  Global projections and subscribers subscribe to events from all pipelines. They are used for
  cross-pipeline metrics like billable event counts.

  Scenario: Dispatched from any pipeline
    Given a global projection or subscriber "projectDailyBillableEvents"
    When an event arrives in the "trace_processing" pipeline
    And the event is stored locally
    Then it is also dispatched to the global projection or subscriber registry
    And the "projectDailyBillableEvents" projection or subscriber reacts to the event

  Scenario: Independent processing
    Given a global projection or subscriber registered in the registry
    When events are dispatched to global projections
    Then they are processed in a dedicated virtual pipeline "global"
    And failures in global projections and subscribers do not affect local pipeline processing
