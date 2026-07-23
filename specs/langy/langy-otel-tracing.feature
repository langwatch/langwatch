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

  # A failed turn should not need the chat panel to explain itself: the turn's
  # trace in the user's project tells the same story, including the provider's
  # own words when a model call was rejected.
  Scenario: A failed turn's trace shows what went wrong
    Given a turn ends in a terminal error
    When the user opens the turn's trace in their project
    Then the trace shows the turn failed and names the failure
    And when the failure was a rejected model call, the trace shows the provider's own error message
    And a completed turn's trace shows no failure

  # Usage on a ChatGPT plan is paid for by the subscription, not per token, so
  # it must not read as billable API spend. Whether a turn was bundled is
  # decided from the account the turn actually ran on, never from what the
  # traced activity claims about itself, so it cannot be forged.
  Scenario: Codex-plan usage appears as bundled cost
    Given a turn runs on the user's ChatGPT plan through Codex
    When the turn's model calls appear in the user's project
    Then their usage reads as bundled with the plan, not billable spend
    And the bundled cost shows on the model calls alone, not the rest of the turn's activity
    And the trace still names the provider that served each call
    But a turn on an API-key provider keeps its normal cost, no matter what the traced activity claims

  # ============================================================================
  # LangWatch's own copy of the turn — the mirror lane (ADR-061)
  #
  # The customer's project gets the turn verbatim — their agent, their prompts.
  # A SECOND copy of the turn goes to LangWatch's own mirror project, so
  # LangWatch can watch Langy work with the same tools customers use. Where the
  # customer's own forward keeps their content and scrubs the platform detail
  # around it, the mirror is the inverse: it scrubs nothing operational — span
  # names, hierarchy, timings, worker identity all survive — and gates only the
  # CONTENT on the customer's tier:
  #   content    — the whole turn including prompts, completions and tool
  #                payloads. The default.
  #   structural — the same operational shape with the content removed. The
  #                prior "LangWatch cannot see content" promise lives on as
  #                THIS tier's guarantee.
  #   skip       — no copy at all.
  # (The separate content-stripped OPS copy that feeds LangWatch's own
  # collector is unchanged, and keeps its fail-closed allowlist.)
  # The tier rides the turn's credentials envelope, resolved per organization
  # by the control plane. A mirror failure is never the customer's problem,
  # and a turn run inside the prod Langy project itself never mirrors.
  # ============================================================================

  Scenario: Worker telemetry remains complete for the customer
    Given the manager is running a worker for a customer conversation
    When the worker reports its activity
    Then the customer's trace contains the worker's complete activity
    And the worker's prompts, completions and tool output remain visible there

  Scenario: The mirror receives the turn at the customer's tier
    Given a customer organization at the default content tier
    When the worker reports its activity
    Then the mirror project receives the turn with its content
    And the mirrored turn keeps the shape the customer sees
    And the mirrored turn names the customer it came from

  Scenario: A restricted customer's mirror carries structure and never content
    Given a customer organization restricted to the structural tier
    When LangWatch records its mirror copy of the turn
    Then operators can see the model, token usage and failure outcome
    And LangWatch cannot see the customer's prompts, completions or tool output

  Scenario: A skipped customer produces no mirror at all
    Given a customer organization at the skip tier
    When the worker reports its activity
    Then the customer's trace is complete
    And nothing about the turn reaches the prod Langy project

  Scenario: A turn in the prod Langy project never mirrors into itself
    Given a conversation whose own project is the prod Langy project
    When the worker reports its activity
    Then exactly one copy of the turn exists
    And no mirror export is attempted

  Scenario: The model-call content follows the same tier on every leg
    Given a customer organization restricted to the structural tier
    When the gateway records the turn's model calls
    Then the customer's trace carries the calls with their content
    And the mirror copy of those calls carries no content

  Scenario: Newly introduced worker metadata cannot expose customer content
    Given the worker reports an unrecognised metadata value
    When LangWatch records operational worker telemetry
    Then the unrecognised value is absent from LangWatch's operational view

  Scenario: Worker diagnostics do not expose raw error text
    Given a worker reports an exception and a provider error description
    When LangWatch records operational worker telemetry
    Then operators can see that the worker failed
    And raw exception and provider error text is absent

  Scenario: Worker identity is not presented as customer identity
    When LangWatch records operational worker telemetry
    Then it identifies the LangWatch worker and conversation
    And customer-controlled worker resource metadata is absent

  Scenario: Customer telemetry is unaffected when operational recording is unavailable
    Given LangWatch cannot record operational worker telemetry
    When the worker reports its activity
    Then the customer's trace still contains the worker's complete activity

  # ============================================================================
  # Provenance cannot be forged by the worker
  #
  # The worker is model-driven and prompt-injectable, so anything it says about
  # who it is must be treated as a claim, not a fact. LangWatch marks its own
  # telemetry as platform-internal; a worker that brands its spans the same way
  # would launder customer content into LangWatch's own view, so the claim is
  # removed on the way to the customer's project no matter how it is dressed up.
  # ============================================================================

  Scenario: A worker cannot claim its telemetry is LangWatch's own
    Given the worker claims its telemetry is LangWatch's own
    When the manager forwards that activity to the customer's project
    Then the provenance claim is absent from the forwarded trace

  Scenario: Repeating the provenance claim does not smuggle it through
    Given the worker repeats its provenance claim several times in one batch
    When the manager forwards that activity to the customer's project
    Then no copy of the provenance claim survives in the forwarded trace

  Scenario: Moving the provenance claim onto individual spans does not smuggle it through
    Given the worker attaches its provenance claim to individual spans
    When the manager forwards that activity to the customer's project
    Then the provenance claim is absent from every forwarded span

  Scenario: Repeating a reserved grouping key does not override the manager's value
    Given the worker repeats a reserved grouping key several times in one batch
    When the manager forwards that activity to the customer's project
    Then the forwarded trace carries only the manager's value for that key

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
