Feature: The CLI streams live progress events for the Langy UI
  As a LangWatch user watching Langy work
  I want the panel to show what the CLI is doing while it does it
  So that a long read is a status line, a rolling stat card and a progress bar
  instead of an opaque spinner

  # Langy runs on opencode and reaches LangWatch through the `langwatch` CLI in a
  # shell (see specs/langy/langy-cli-tool-envelope.feature). The shell gives the
  # UI nothing until the command exits, so every read renders as a spinner.
  #
  # The CLI therefore emits OTEL *log records* — not spans — on a live channel
  # while a command runs. The control plane reads them off the collector and
  # bridges them to the turn's ephemeral status/progress/metric signals, which the
  # existing StreamingStatusLine + StreamingStatCard already consume.
  #
  # The channel is OFF unless explicitly switched on. The CLI is a user-facing
  # product: an unconfigured install must not pay a single millisecond, open a
  # single socket, or print a single extra line for a feature it is not using.

  Rule: The channel is inert unless it is explicitly switched on

    @unit
    Scenario: No events are emitted when the feature flag is unset
      Given the live event channel is not switched on
      When a command emits its lifecycle events
      Then no exporter is constructed
      And no telemetry request is made

    @unit
    Scenario: No events are emitted when the flag is on but no collector is configured
      Given the live event channel is switched on
      But no OTLP endpoint is configured
      When a command emits its lifecycle events
      Then no exporter is constructed
      And no telemetry request is made

    @unit
    Scenario: The channel switches on when the flag and a collector are both present
      Given the live event channel is switched on
      And an OTLP endpoint is configured
      When a command emits its lifecycle events
      Then the events are exported to the collector

  Rule: A read command reports its life cycle in a stable vocabulary

    @unit
    Scenario: A trace search reports start, count, progress and completion
      Given the live event channel is switched on
      When I search traces and the platform reports matching traces
      Then a started event carries the resource, the verb and a human message
      And a count event carries the number of matching traces
      And a progress event carries a fraction between zero and one
      And a completed event carries the final count and how long it took

    @unit
    Scenario: A failed command reports an error event
      Given the live event channel is switched on
      When I search traces and the platform rejects the request
      Then an error event carries the failure message
      And the command still fails the way it always did

    @unit
    Scenario: The same vocabulary describes other read commands
      Given the live event channel is switched on
      When I list datasets
      Then the events name the dataset resource and the list verb

  Rule: Telemetry never becomes the user's problem

    @unit
    Scenario: A collector that rejects the export does not fail the command
      Given the live event channel is switched on
      But the collector rejects every export
      When I search traces
      Then the search result is printed exactly as it always was
      And the command exits successfully

    @unit
    Scenario: A collector that never answers does not hang the command
      Given the live event channel is switched on
      But the collector never answers
      When I search traces
      Then the command still finishes promptly

  Rule: An error event never carries a credential

    @unit
    Scenario: A failure whose message quotes the API key is redacted
      Given the live event channel is switched on
      And my API key is configured
      When a command fails with a message that quotes my API key
      Then the error event does not contain my API key

  Rule: The events are correlated to the Langy turn that caused them

    @unit
    Scenario: The turn the CLI was run for is carried on the events
      Given the live event channel is switched on
      And the worker declares the conversation and turn it is running for
      When a command emits its lifecycle events
      Then the events carry that conversation and turn
