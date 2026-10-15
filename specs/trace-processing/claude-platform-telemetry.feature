Feature: Claude SDK and Claude API OpenTelemetry spans

  The Claude SDK traces each Messages request with an `anthropic.messages.create`
  CLIENT span. When the organisation also exports API telemetry, the API adds an
  `anthropic.messages.create` SERVER span for the same request (the SDK span is
  its parent), with an `anthropic.model_request` child for each model request and
  an `anthropic.compaction` child for each compaction. Every one of these spans
  carries token usage, so summing them all counts one request two or three times.

  A request is counted once per project, by its `anthropic.request.id`: the first
  `anthropic.messages.create` span to arrive for a request id carries the usage,
  and any later one for the same id is marked as counted elsewhere. Both spans
  report the usage of the same response, so the total is the same whichever
  arrives first. The mark is a span attribute set when the span is received, so
  every total (trace summary, analytics, per-model breakdowns, rollups) agrees,
  whatever order the spans arrive in. Spans are never dropped: a span counted
  elsewhere still shows its own usage.

  Inside the API spans of a Messages request, only `anthropic.messages.create`
  counts. Its `anthropic.usage.compaction.*` attributes add the compaction usage,
  so the `anthropic.compaction` spans do not count as well. In a Managed Agents
  session there is no `anthropic.messages.create`: the `anthropic.model_request`
  and `anthropic.session.outcome_evaluation` spans count.

  Spans that follow the OpenTelemetry GenAI conventions report
  `gen_ai.usage.input_tokens` with the cache reads and writes included, and say
  so by sending `gen_ai.usage.cache_write.input_tokens`. LangWatch keeps the
  input count as the fresh remainder, with cache reads and cache writes in their
  own buckets, so each token is priced once at its catalogue rate.

  Background:
    Given a project receiving OpenTelemetry spans from the Claude SDK, the Claude API, or both

  @bdd @trace-processing @claude-platform @integration
  Scenario: A request traced by the SDK and the API counts its usage once
    Given the SDK span for a request reports 1200 input and 85 output tokens on claude-opus-4-7
    And the API sends its messages.create span and two model_request spans for the same request
    When the SDK spans arrive before the API spans
    Then the trace totals 1200 prompt tokens and 85 completion tokens
    And the trace cost is the cost of 1200 input and 85 output tokens of claude-opus-4-7
    And each span still shows its own token usage

  @bdd @trace-processing @claude-platform @integration
  Scenario: The usage counts once whichever source arrives first
    Given the SDK span and the API spans for the same request
    When the API spans arrive before the SDK span
    Then the trace totals 1200 prompt tokens and 85 completion tokens
    And the SDK span is marked as counted elsewhere

  @bdd @trace-processing @claude-platform @integration
  Scenario: A resent API export does not count the request again
    Given the SDK span and the API spans for the same request have been received
    When the API sends the same spans again
    Then the trace totals 1200 prompt tokens and 85 completion tokens

  @bdd @trace-processing @claude-platform @integration
  Scenario: An API span sent without the SDK's trace context still counts the request once
    Given the SDK span for a request in the application's trace
    And the API spans for the same request in a trace of their own, because no traceparent header was sent
    When both traces are processed
    Then the request's usage counts once across the two traces

  @bdd @trace-processing @claude-platform @integration
  Scenario: A request traced only by the SDK counts its messages.create span
    Given only the SDK span for a request reports 1200 input and 85 output tokens
    When the trace is processed
    Then the trace totals 1200 prompt tokens and 85 completion tokens

  @bdd @trace-processing @claude-platform @integration
  Scenario: A request traced only by the API counts its messages.create span, not its model requests
    Given only the API spans for a request, with two model_request spans that add up to the request
    When the trace is processed
    Then the trace totals 1200 prompt tokens and 85 completion tokens

  @bdd @trace-processing @claude-platform @integration
  Scenario: Each attempt of a request the SDK retried counts once
    Given the SDK span for a request that the SDK sent twice
    And the API sent a messages.create span for each attempt, with different request ids
    When the trace is processed
    Then the trace counts the usage of both attempts once each

  @bdd @trace-processing @claude-platform @integration
  Scenario: A Managed Agents session counts its model requests and outcome evaluations
    Given a session turn with two model_request spans and an outcome_evaluation span
    When the trace is processed
    Then the trace totals the usage of the model requests and the outcome evaluation
    And the session turn adds nothing

  @bdd @trace-processing @claude-platform @unit
  Scenario: Compaction usage is counted once, on the messages.create span
    Given a messages.create span reporting compaction usage in its anthropic.usage.compaction attributes
    And an anthropic.compaction span with the same usage
    When the spans are processed
    Then the messages.create span's token counts include the compaction usage
    And the compaction span is marked as counted elsewhere

  @bdd @trace-processing @claude-platform @unit
  Scenario: A token count request is not usage
    Given an anthropic.messages.count_tokens span with a token count
    When the span is processed
    Then the span adds no tokens and no cost to the trace

  @bdd @trace-processing @claude-platform @unit
  Scenario: Spans from other sources that nest model calls are counted as before
    Given a parent model-call span and a child model-call span from another instrumentation
    When the spans are processed
    Then neither span is marked as counted elsewhere

  @bdd @trace-processing @claude-platform @cache-telemetry @unit
  Scenario: A GenAI convention span's cache write is priced at the catalogue cache-write rate
    Given a span reporting 3000 input tokens that include 500 cache-read and 2000 cache-write tokens
    When the span is processed
    Then its input tokens are the 500 fresh tokens
    And it records 500 cache-read and 2000 cache-write tokens
    And its cost prices each bucket once at the catalogue rate for that bucket

  @bdd @trace-processing @claude-platform @cache-telemetry @unit
  Scenario: Two calls that write and then read a cached prompt are priced once per token
    Given an SDK call on claude-haiku-4-5 with 15232 input tokens, of which 15217 were written to the cache, and 22 output tokens
    And a second call with 15232 input tokens, of which 15217 were read from the cache, and 22 output tokens
    When the trace is processed
    Then the trace totals 30 fresh input tokens, 15217 cache-write tokens and 15217 cache-read tokens
    And the trace cost is 0.020793 USD at the catalogue rates

  @bdd @trace-processing @claude-platform @cache-telemetry @unit
  Scenario: Anthropic one-hour cache writes are priced at the one-hour rate
    Given a messages.create span whose cache writes all went to the one-hour cache
    When the span is processed
    Then its cache writes are priced at the catalogue one-hour cache-write rate

  @bdd @trace-processing @claude-platform @cache-telemetry @unit
  Scenario: An input count smaller than its cache buckets is left as sent
    Given a span whose input tokens are fewer than its cache-read and cache-write tokens
    When the span is processed
    Then its input tokens are left as the emitter sent them

  @bdd @trace-processing @claude-platform @unit
  Scenario: A Claude tool span shows the tool result as its output
    Given a tool span carrying the result in anthropic.tool_result.content
    When the span is processed
    Then the span's output is the tool result

  @bdd @trace-processing @claude-platform @unit
  Scenario: Dropping tool content drops the Claude tool result
    Given a project that drops tool content
    Then anthropic.tool_result.content is one of the tool content attributes it drops
