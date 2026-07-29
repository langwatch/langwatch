Feature: Pipeline Model

  The event sourcing system is organized into independent pipelines. Each pipeline
  defines its own domain logic, events, and projections.

  A pipeline is composed in one file, `pipelines/<name>/pipeline.ts`, and that
  file states the whole topology: what the pipeline folds, what it maps, what it
  dispatches and what it defers. The dependencies it takes are inert — stores,
  repositories, clients, scalars and narrow function ports. What it *does* is
  not a dependency; it is constructed in the file, from symbols the file imports.

  That is ADR-082's Rule 1, and it is the rule that keeps `pipeline.ts` worth
  reading. Hand a pipeline its own subscriber and the file stops describing the
  system: the reader has to go and find the composition root to learn what
  actually runs. The rule drifted once already — a pipeline's docblock claimed
  compliance while six of its dependencies violated it — so it is checked
  mechanically rather than reviewed by eye. The check reads the source, because
  the distinction it draws disappears at runtime: a projection that was injected
  and a projection that was constructed in the factory are the same object once
  the pipeline is built.

  Violations that exist today are carried on a list that may only shrink. An
  entry may be deleted when the violation is closed; adding one is a failure,
  and so is leaving one behind after the code stopped violating. A list that
  tolerates dead entries has stopped describing the code and started hiding it.

  @unit @adr-082
  Scenario: A pipeline dependency is never a value the builder registers
    Given every pipeline composed by the static pipeline builder
    When each pipeline's dependencies and builder calls are read
    Then no dependency is a fold projection, map projection, state projection,
      event subscriber, process manager or command handler the builder registers
    And no such dependency is handed to a registering builder call unchanged
    And any violation that is not on the known-violations list fails the build

  @unit @adr-082
  Scenario: The known-violations list only ever shrinks
    Given a known-violations list naming the pipelines that still break the rule
    When a listed dependency stops violating the rule
    Then leaving its entry on the list fails the build

  @unit @adr-082
  Scenario: A dependency typed as a registered definition is named with its type
    Given a pipeline whose dependency is typed as a map projection definition
    When the rule is checked
    Then the failure names the pipeline, the dependency, the forbidden type and
      the builder method that would have registered it

  @unit @adr-082
  Scenario: A dependency handed straight to a registering call is named with that call
    Given a pipeline that passes a dependency directly to a registering builder call
    When the rule is checked
    Then the failure names the pipeline, the dependency and the builder call it
      was handed to
    And the dependency is caught even when its declared type reveals nothing

  @unit @adr-082
  Scenario: A registered value hidden inside a dependency bundle is still a violation
    Given a pipeline whose dependency is a bundle declared in the same file
    And that bundle holds an event subscriber definition
    When the rule is checked
    Then the failure names the nested dependency by its full path

  @unit @adr-082
  Scenario: A dependency used as an argument to a constructed value is legal
    Given a pipeline that constructs its projections and process managers itself
    And passes its dependencies to them as arguments
    When the rule is checked
    Then no violation is reported

  @unit @adr-082
  Scenario: Every builder method is classified as registering or not
    Given the rule's list of the builder methods that register a value
    And its list of the builder methods that register nothing
    When the builder gains a method neither list names
    Then the build fails until the new method is classified

  @unit
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

  # The two runtime scenarios below are parked, not absent. Pipelines are
  # registered and commands dispatched end-to-end in the per-pipeline
  # integration suites; none of those tests carries a @scenario annotation, so
  # nothing here is bound to them yet. Binding them means annotating tests in
  # `pipelines/*/__tests__/`, which is a separate change from this one.
  @unimplemented
  Scenario: Registering a pipeline with the runtime
    Given a static pipeline definition "trace_processing"
    And an EventSourcing runtime with ClickHouse and Redis
    When I register the pipeline definition
    Then the EventSourcingService is initialized
    And the ProjectionRouter is configured with fold and map projections
    And the command dispatchers are created as queue processors

  @unimplemented
  Scenario: Command execution flow
    Given a registered pipeline "trace_processing"
    When I send a "recordSpan" command with a payload
    Then the command is validated against its schema
    And the command is enqueued for asynchronous processing
    And the command handler produces one or more events
    And the events are stored in the EventStore
    And the events are dispatched to the ProjectionRouter
