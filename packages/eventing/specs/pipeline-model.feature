Feature: Pipeline Model

  The event sourcing system is organized into independent pipelines. Each pipeline
  defines its own domain logic, events, and projections.

  Scenario: Defining a pipeline
    Given a static pipeline builder
    When I define a pipeline with:
      | Name           | trace_processing |
      | Aggregate Type | trace            |
    And I register a command "recordSpan"
    And I register a fold projection "traceSummary"
    And I register a map projection "spanStorage"
    Then the pipeline definition is created with all components
    And the pipeline metadata is generated for introspection

  Scenario: Registering a pipeline with the runtime
    Given a static pipeline definition "trace_processing"
    And an EventSourcing runtime with ClickHouse and Redis
    When I register the pipeline definition
    Then the EventSourcingService is initialized
    And the ProjectionRouter is configured with fold and map projections
    And the command dispatchers are created as queue processors

  Scenario: Command execution flow
    Given a registered pipeline "trace_processing"
    When I send a "recordSpan" command with a payload
    Then the command is validated against its schema
    And the command is enqueued for asynchronous processing
    And the command handler produces one or more events
    And the events are stored in the EventStore
    And the events are dispatched to the ProjectionRouter
