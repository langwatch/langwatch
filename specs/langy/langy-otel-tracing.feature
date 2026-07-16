Feature: Langy agent activity is traced into the user's project
  As a LangWatch user running Langy
  I want Langy's agent activity (LLM calls, tool calls) captured as traces
  So that I can observe and debug what Langy did, in my own project, tagged "langy"

  # Part of epic #4528 (issue #4536), reworked for host-mediated telemetry.
  #
  # The Langy manager (services/langyagent) spawns one `opencode serve`
  # subprocess per conversation. The worker's telemetry is HOST-MEDIATED:
  # the worker exports OTLP over loopback to the manager (no LangWatch key in
  # the worker env), and the manager — which holds the per-conversation
  # session key — re-parents the worker's spans under the turn's trace and
  # forwards them to the customer's LangWatch project at
  # POST <LANGWATCH_ENDPOINT>/api/otel/v1/traces.
  #
  # Rationale: the previous design (an external opencode OTel plugin exporting
  # directly, authenticated with the key in the worker env) both put a secret
  # in the model-driven subprocess and cost 14-28s of module-load at first
  # message, killing turns. opencode's NATIVE OTel export
  # (experimental.openTelemetry + standard OTEL_EXPORTER_OTLP_* env)
  # bootstraps in ~0s and needs no plugin.
  #
  # opencode does not speak W3C trace propagation (it neither reads nor emits
  # traceparent), so the MANAGER is the propagation seam: it knows each turn's
  # trace context (extracted from the control plane's request) and stitches
  # the worker's spans and the gateway's gen_ai span onto it.

  Background:
    Given a project with a provisioned dedicated Langy session key
    And the Langy manager is running with the worker telemetry relay

  # ============================================================================
  # Worker-side export wiring (no secrets in the worker)
  # ============================================================================

  Scenario: The worker exports OTLP to the manager over loopback
    Given the manager spawns an opencode subprocess for a conversation
    Then the subprocess environment points OTEL_EXPORTER_OTLP_ENDPOINT at a loopback manager address
    And the OTLP protocol is "http/protobuf"
    And the generated opencode config enables native OpenTelemetry export
    And the subprocess environment carries no OTLP authorization header

  Scenario: The worker environment carries no LangWatch OTLP secret
    Given the manager spawns an opencode subprocess for a conversation
    Then no OTLP exporter header in the worker environment contains the session key
    And the loopback export path is scoped by an unguessable per-worker routing token

  # ============================================================================
  # Manager-side re-parenting and forwarding
  # ============================================================================

  Scenario: Worker spans are re-parented under the turn's trace
    Given a turn is in flight for conversation "conv-123" with a known trace context
    When the worker exports a span batch to the manager's loopback OTLP endpoint
    Then every forwarded span carries the turn's trace id
    And every root span in the batch is parented on the turn's span
    And spans keep their internal parent/child relationships

  Scenario: Forwarded traces land in the customer's project
    When the manager forwards a worker span batch
    Then it POSTs OTLP protobuf to "<LANGWATCH_ENDPOINT>/api/otel/v1/traces"
    And it authenticates with the conversation's session key as a Bearer token
    And the resource attributes include "tag.tags=langy"
    And the resource attributes include "langwatch.thread.id=<conversationId>"

  Scenario: A span batch with no turn in flight still reaches the project
    Given no turn trace context has been recorded for the conversation yet
    When the worker exports a span batch
    Then the batch is forwarded without re-parenting
    And the resource attributes still tag it "langy" with the conversation's thread id

  Scenario: An unknown routing token is rejected
    When a span batch is posted to the loopback endpoint with an unknown token
    Then the manager rejects it and forwards nothing

  Scenario: A dead worker's routing token stops working
    Given a worker is killed or exits
    When a span batch is posted with that worker's token
    Then the manager rejects it and forwards nothing

  # ============================================================================
  # Manager-mediated LLM calls (phase 2)
  # ============================================================================

  Scenario: The worker's LLM traffic goes through the manager
    Given the manager spawns an opencode subprocess for a conversation
    Then the subprocess environment points the LLM base URL at a loopback manager address
    And the subprocess environment does not contain the LLM virtual key

  Scenario: The manager injects the virtual key and the turn's trace context
    Given a turn is in flight with a known trace context
    When the worker makes an LLM call through the manager
    Then the request forwarded to the AI gateway authenticates with the virtual key
    And the forwarded request carries a traceparent continuing the turn's trace

  Scenario: Streaming LLM responses pass through unbuffered
    When the worker makes a streaming LLM call through the manager
    Then each server-sent event is flushed to the worker as it arrives

  # ============================================================================
  # End-to-end: a Langy chat becomes one continuous, labeled trace
  # ============================================================================

  Scenario: A Langy chat produces a trace in the user's project
    When I send a message to Langy in my project
    Then a trace appears in that same project
    And the trace's labels contain "langy"

  Scenario: Turns of one conversation are grouped together
    Given a Langy conversation with id "conv-123"
    When I send two messages in that conversation
    Then both resulting traces share thread_id "conv-123"

  # ============================================================================
  # Ingestion: reserved metadata keys in OTLP resource attributes
  # Covered by src/server/tracer/__tests__/metadataLabels.integration.test.ts
  # ============================================================================

  Scenario: tag.tags in resource attributes becomes trace labels
    Given an OTLP trace whose resource attributes include "tag.tags=langy"
    When the trace is ingested at /api/otel/v1/traces
    Then the stored trace's labels contain "langy"

  Scenario: langwatch.thread.id in resource attributes becomes thread_id
    Given an OTLP trace whose resource attributes include "langwatch.thread.id=conv-123"
    When the trace is ingested
    Then the stored trace's thread_id is "conv-123"
