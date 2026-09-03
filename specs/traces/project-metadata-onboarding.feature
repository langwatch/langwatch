Feature: Project becomes integrated after first trace ingestion
  Projects using event-sourcing ingestion mark themselves as integrated
  when the first trace arrives, enabling the messages page to render
  the trace list instead of the welcome screen.

  # The 2 @unimplemented scenarios describe the trace-processing
  # pipeline marking projects as integrated. Need a targeted unit test
  # in `[gone] src/server/event-sourcing/pipelines/trace-processing/`
  # for the project.firstMessage projection.

  @integration
  Scenario: Project marks as integrated after first trace ingestion
    Given a project with firstMessage set to false
    And the project uses event-sourcing ingestion
    When a trace is processed through the trace-processing pipeline
    Then project.firstMessage is set to true
    And project.integrated is set to true
    And project.language is detected from SDK attributes

  # ---------------------------------------------------------------------------
  # PostHog product analytics on the firstMessage transition
  #
  # The Customer.io nurturing integration tracks a separately named
  # first_trace_integrated event from its own subscriber; these scenarios are
  # about the PostHog milestone fired by the projectMetadata subscriber.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: First trace tracks the PostHog integration milestone against the org admin
    Given a project with firstMessage set to false
    When a trace is processed through the trace-processing pipeline
    Then a "first_trace_integrated" PostHog event is tracked for the org admin user
    And the event carries only sdk_language, sdk_framework and the project id

  @unit
  Scenario: PostHog integration milestone reports unknown when SDK attributes are absent
    Given a project with firstMessage set to false
    And the trace carries no sdk.language or langwatch.sdk.framework attribute
    When a trace is processed through the trace-processing pipeline
    Then the "first_trace_integrated" PostHog event reports both SDK properties as "unknown"

  @unit
  Scenario: PostHog integration milestone is skipped when the project has no org admin
    Given a project with firstMessage set to false
    And the project resolves no org admin user
    When a trace is processed through the trace-processing pipeline
    Then no "first_trace_integrated" PostHog event is tracked

  @unit
  Scenario: PostHog integration milestone fires only on the firstMessage transition
    Given a project that already received its first message
    When another trace is processed through the trace-processing pipeline
    Then no "first_trace_integrated" PostHog event is tracked

  @unit
  Scenario: PostHog integration milestone is not tracked when the metadata write fails
    Given a project with firstMessage set to false
    And the project metadata write throws
    When a trace is processed through the trace-processing pipeline
    Then no "first_trace_integrated" PostHog event is tracked

  @integration @unimplemented
  Scenario: The Trace Explorer renders the trace list for integrated projects
    Given a project with firstMessage = true
    When the user opens the Trace Explorer
    Then the trace list is rendered instead of the setup journey
    # The legacy Traces page owned this gate through
    # api.project.getHasFirstMessage; it was removed with that page and the
    # Trace Explorer now decides from its own `hasAnyTraces` result, which
    # answers the same question without a second query. The dedicated
    # setup screen still lives at /[project]/setup. project.firstMessage is
    # set by the projectMetadata subscriber on first trace ingestion.
