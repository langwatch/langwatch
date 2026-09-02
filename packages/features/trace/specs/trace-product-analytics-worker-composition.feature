Feature: Delivering the trace ingestion path's product event from a worker

  The trace ingestion path emits exactly one product-usage event —
  `first_trace_integrated`, at most once per project, the terminal step of the
  onboarding funnel. The application sends it to PostHog. A background process
  that owned the same ingestion path and only logged it would undercount that
  funnel forever, on precisely the deployment that paid for the analytics.

  So the process gets a real capture client, configured from the same two
  environment variables the application reads, and behaves the way the
  application behaves when they are absent: a deployment that named no
  `POSTHOG_KEY` chose not to run product analytics, and both halves record
  nothing. That is parity, not a gap.

  The event is keyed by the organisation admin's user id, because that is the
  distinct id `posthog-js` identifies the same person with in the browser. A
  process that keyed it any other way would file the milestone against a person
  who does not exist in the funnel.

  @unit
  Scenario: A deployment that configured no product analytics records nothing
    Given a process whose deployment named no PostHog key
    When the first-trace milestone is recorded
    Then no capture leaves the process and nothing fails

  @unit
  Scenario: A deployment that configured PostHog delivers the milestone
    Given a process whose deployment named a PostHog key
    When the first-trace milestone is recorded
    Then the event is captured under its own name

  @unit
  Scenario: The milestone is attributed to the person the browser knows
    Given a first trace whose project resolves to an organisation admin
    When the milestone is captured
    Then the admin's user id is the distinct id it is captured against

  @unit
  Scenario: The project rides along as a property
    Given a milestone carrying the SDK language and framework
    When the milestone is captured
    Then the project id joins those properties rather than replacing them

  @unit
  Scenario: A milestone with no project carries no project property
    Given a product event recorded without a project
    When the milestone is captured
    Then the captured properties contain no project key at all

  @unit
  Scenario: Recording never fails the trace that caused it
    Given a capture client that throws
    When the first-trace milestone is recorded
    Then the ingestion path is not interrupted

  @unit
  Scenario: Pending events are flushed when the process shuts down
    Given a process holding a capture client with queued events
    When the process closes its resources
    Then the client is shut down so the queue is flushed

  @unit
  Scenario: The host is the deployment's own, never one invented here
    Given a deployment that named a PostHog host
    When the capture client is built
    Then it is built against that host and no default is substituted
