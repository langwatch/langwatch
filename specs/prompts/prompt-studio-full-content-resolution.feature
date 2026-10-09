Feature: Prompt studio opens the full offloaded prompt, not the preview
  As a user clicking "Open in Playground" on a traced LLM call
  I want the playground to load the complete messages and config that were
  actually sent, even when they were too large to keep in full in the span row
  So that I can reproduce and iterate on the real call rather than on its
  first ~64KB

  # Sibling of specs/traces-v2/trace-header-full-content-resolution.feature,
  # and the last of the "all read paths" backlog for the >64KB span-IO offload
  # (#4991 / ADR-022) that #5082's review listed. The evaluation reads were
  # closed by #5752 and the v2 trace header by #5751; getSpanForPromptStudio
  # was the remaining one. Both links are covered: the span-only link and the
  # trace-named link, which restores under the one project its proof reads.
  #
  # Two things had to be true for the playground to show a truncated prompt,
  # and both were:
  #   1. The tRPC procedure built its TraceService with no blob-resolution
  #      deps, while its own neighbour in the same router (getAllForTrace)
  #      passed buildTraceBlobResolutionDeps().
  #   2. getSpanForPromptStudio reads stored_spans and turns SpanAttributes
  #      straight into messages and llm config, so it never passed through
  #      the resolver the trace paths use.
  #
  # Fix: resolveOffloadedSpanAttributes, the per-span unit the trace resolver
  # already ran for every span and which is now callable on its own, is injected into the
  # ClickHouse service the same way resolveTraceSpans already is, and applied
  # to the llm span before extraction. No second copy of the resolution logic,
  # and the same keep-the-preview-on-failure policy.

  Background:
    Given a traced LLM call whose langwatch.input was offloaded to event_log
        at ingestion (release_trace_blob_offload was on)
    And the span row in stored_spans holds only the bounded preview, under a
        langwatch.reserved.eventref.langwatch.input pointer

  @unit
  Scenario: Opening the span in prompt studio resolves the full messages
    When the prompt studio read fetches this span
    Then the returned messages carry the full original value, not the preview

  @unit
  Scenario: Restored content replaces the pointer rather than sitting beside it
    When the span's attributes are resolved
    Then the input reads as the full original value
    And no internal pointer key is left on the span for a reader to see

  @unit
  Scenario: An ordinary prompt opens as fast as it always did
    Given a traced LLM call whose input never exceeded the offload threshold
    When the prompt studio read fetches this span
    Then the returned messages match the stored attributes directly
    And the read pays for no extra lookup

  @unit
  Scenario: A missing event_log row does not break the read
    Given the eventref points at an event_log row that no longer exists
    When the prompt studio read fetches this span
    Then the span is still returned
    And the returned messages fall back to the stored preview

  @unit
  Scenario: Resolution is scoped to the tenant that owns the trace
    When the prompt studio read fetches this span
    Then the event_log read is made for that trace's project and no other

  @unit
  Scenario: Opening one prompt does not pay to restore the whole trace
    Given the trace also holds a sibling span with its own offloaded content
    When the prompt studio read fetches the llm span
    Then only the span the playground will show is restored, and the siblings
        are left as they are

  # Resolution is a shared primitive with two callers now, so the property the
  # whole-trace caller depends on is stated rather than assumed: resolving one
  # span must leave the rest of the trace alone.

  @unit
  Scenario: One offloaded span does not disturb the rest of the trace
    Given a trace where one span carries an eventref and another does not
    When the trace's spans are resolved
    Then the span without one still shows exactly its stored content
    And the span with one shows its full restored value

  @unit
  Scenario: Resolution follows the span the playground will actually open
    Given the user opened the playground from a non-llm span, so the read
        resolves to the nearest llm span in the trace
    When the prompt studio read fetches it
    Then it is that llm span's IO that is restored, not the clicked span's

  @unit
  Scenario: A resolver that fails outright still opens the playground
    Given resolution raises rather than degrading per field
    When the prompt studio read fetches the span
    Then the span is still returned, on its stored preview
    And the playground opens instead of showing nothing

  # A link that names its trace reads through the caller's proof (ADR-144).
  # The content it restores lives outside ClickHouse, under one project id, so
  # restoring it is a tenant-isolation question: a proof that reads exactly one
  # project restores under that project, and any wider proof restores nothing.

  @unit
  Scenario: A trace-named link opens the full prompt
    Given the playground link names the trace as well as the span
    When the prompt studio read fetches the llm span through the caller's proof
    Then the returned messages carry the full original value, not the preview
    And no internal pointer key is left on the span for a reader to see

  @unit
  Scenario: An aggregate narrowed to a member reads the member's content
    Given an aggregate project whose proof is narrowed to the member holding the trace
    When the prompt studio read fetches the llm span
    Then the offloaded content is read for that member and never for the aggregate

  @unit
  Scenario: A proof that reads several projects keeps the preview
    Given the caller's proof still reads more than one project
    When the prompt studio read fetches the llm span
    Then no offloaded content is read for any project
    And the returned messages fall back to the stored preview

  @unit
  Scenario: A span outside the plan's visibility window keeps the preview
    Given the span started before the plan's visibility window opens
    When the prompt studio read fetches the llm span
    Then no offloaded content is read
    And the returned messages fall back to the stored preview

  @unit
  Scenario: Unavailable content keeps the preview
    Given the offloaded content cannot be read, or the service has no way to read it
    When the prompt studio read fetches the llm span
    Then the span is still returned
    And the returned messages fall back to the stored preview

  @unit
  Scenario: A trace-named link restores the span the playground opens
    Given the link names a non-llm span, so the read resolves to the nearest llm span
    When the prompt studio read fetches it through the caller's proof
    Then it is that llm span's content that is restored, not the clicked span's

  @unit
  Scenario: A span that is not in the trace restores nothing
    Given the link names a span the trace does not hold
    When the prompt studio read fetches it through the caller's proof
    Then the span is reported as not found
    And no offloaded content is read
