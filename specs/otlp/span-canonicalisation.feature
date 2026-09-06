Feature: Every supported instrumentation canonicalises to the same span shape

  Traces arrive from nine different instrumentation vendors. Whichever one
  produced a span, canonicalisation must yield the same model, input, output
  and token counts — and a span nothing recognises must still be kept.

  # otlp-trace-request.service.ts, otlp-attribute-flattening.service.ts,
  # openinference-, logfire-, mastra-, haystack-, spring-ai-, langwatch-,
  # legacy-otel-, copilot-, fallback-canonicaliser.service.ts,
  # canonical-extraction.rules.ts, span-status.service.ts, gen-ai-span.service.ts,
  # span-record-identity.service.ts

  @unit @unimplemented
  Scenario: A span from each supported instrumentation canonicalises to the same shape
    Given one LLM call captured by each supported instrumentation
    When each span is canonicalised
    Then every one yields the same model, input, output and token counts

  @unit
  Scenario: A span following the OTel GenAI semantic conventions canonicalises its model and response metadata
    Given a span carrying OTel GenAI semantic-convention attributes
    When the span is canonicalised
    Then its operation, provider, model and response metadata are preserved

  @unit @unimplemented
  Scenario: A span from an unrecognised instrumentation is kept, not dropped
    Given a span carrying attributes no canonicaliser claims
    When it is ingested
    Then it is stored with its attributes intact and no type inferred

  @unit @unimplemented
  Scenario: Two canonicalisers claiming one span resolve to one deterministic winner
    Given a span carrying attributes from two instrumentations
    When it is canonicalised
    Then the same canonicaliser wins on every run

  @unit @unimplemented
  Scenario: An OTLP request with a malformed span rejects that span and keeps the rest
    Given an export carrying one unparseable span among valid ones
    When it is ingested
    Then the valid spans are stored and the export is not rejected wholesale

  @unit @unimplemented
  Scenario: A flattened array attribute round-trips to the array it came from
    Given an attribute the SDK flattened into indexed keys
    When the request is parsed
    Then the original array is reconstructed in order

  @unit
  Scenario: Flattened array-pattern attributes reconstruct into objects
    Given attributes flattened into consecutive indexed keys
    When the attributes are normalized
    Then they reconstruct into the same array of objects

  @unit @unimplemented
  Scenario: A span with an error status carries that status into the trace summary
    Given a span reporting an error status with a message
    When the trace is summarised
    Then the trace reads as errored and names the message
