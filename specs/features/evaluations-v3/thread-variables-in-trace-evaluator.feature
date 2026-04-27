Feature: Thread variables available in trace-level evaluator input mapping
  As an evaluator author
  I want to map thread-level variables (thread_id, traces, formatted_traces) to evaluator inputs at the trace level
  So that I can build evaluators that consider full conversation context even when triggered per-trace

  Note: Trace-level evaluations fire per incoming trace. Thread context reflects
  whatever traces exist at evaluation time — trace #1 sees only itself,
  trace #5 sees all five. There is no thread idle timeout at trace level.

  Background:
    Given a project with traces that have thread_id metadata
    And an evaluator with configurable input mappings

  # --------------------------------------------------------------------------
  # Frontend: EvaluatorMappingsSection exposes thread sources alongside trace sources
  # --------------------------------------------------------------------------

  @unit
  Scenario: Trace-level mapping UI includes both trace and thread available sources
    Given the evaluator mapping level is "trace"
    When the available sources are computed for the mapping UI
    Then the sources include a "Trace" group with trace-level fields
    And the sources include a "Thread" group with thread-level fields

  @unit
  Scenario: Thread-level mapping UI still shows only thread sources
    Given the evaluator mapping level is "thread"
    When the available sources are computed for the mapping UI
    Then the sources include a "Thread" group with thread-level fields
    And the sources do not include a "Trace" group

  @unit
  Scenario: Thread source fields include thread_id, traces, and formatted_traces
    Given the evaluator mapping level is "trace"
    When the available sources are computed for the mapping UI
    Then the "Thread" group contains the field "thread_id"
    And the "Thread" group contains the field "traces"
    And the "Thread" group contains the field "formatted_traces"

  # --------------------------------------------------------------------------
  # Serialization: OnlineEvaluationDrawer handles mixed trace + thread mappings
  # --------------------------------------------------------------------------

  @unit
  Scenario: Serialization marks thread sources with type "thread" including SERVER_ONLY_THREAD_SOURCES
    Given a trace-level evaluator with "conversation" mapped to "thread.formatted_traces"
    When the mapping is serialized to MappingState
    Then the "conversation" entry has type "thread" and source "formatted_traces"

  @unit
  Scenario: Deserialization assigns sourceId "thread" for thread-typed mappings at trace level
    Given a saved trace-level monitor with a thread-typed mapping for "conversation"
    When the mapping is deserialized for the UI
    Then the "conversation" field has sourceId "thread"
    And the path correctly reconstructs the thread source and selectedFields

  # --------------------------------------------------------------------------
  # Backend: buildDataForEvaluation resolves mixed trace + thread sources per-field
  # --------------------------------------------------------------------------

  @integration
  Scenario: Trace-level evaluation resolves a thread source mapping
    Given a trace-level evaluator with an input mapped to "thread.traces"
    When buildDataForEvaluation runs for a trace with thread_id "abc"
    Then it fetches all traces in thread "abc"
    And the evaluator input contains the thread traces data

  @integration
  Scenario: Trace-level evaluation resolves mixed trace and thread source mappings
    Given a trace-level evaluator with "input" mapped to "trace.input" and "conversation" mapped to "thread.formatted_traces"
    When buildDataForEvaluation runs for a trace with thread_id "abc"
    Then the "input" field contains the trace input value
    And the "conversation" field contains the formatted thread digest

  @integration
  Scenario: Trace-level evaluation with thread source but trace has no thread_id
    Given a trace-level evaluator with an input mapped to "thread.traces"
    When buildDataForEvaluation runs for a trace without thread_id
    Then the thread-sourced field resolves to an empty value
    And trace-sourced fields still resolve normally
    And the evaluation does not fail

  @unit
  Scenario: hasThreadMappings detects thread-typed mappings in a mixed config
    Given a mapping state with one trace source and one thread source
    When hasThreadMappings is called
    Then it returns true

  # --------------------------------------------------------------------------
  # Background worker: same resolution logic applies
  # --------------------------------------------------------------------------

  @integration
  Scenario: Background worker resolves mixed trace and thread mappings
    Given a trace-level monitor with "input" mapped to "trace.input" and "history" mapped to "thread.traces"
    When the evaluations worker processes a trace with thread_id "xyz"
    Then both trace and thread fields resolve correctly

  # --------------------------------------------------------------------------
  # UI label: rename "Threads" tab to "Thread" in DatasetMappingPreview
  # --------------------------------------------------------------------------

  @unit
  Scenario: DatasetMappingPreview tab label reads "Thread" not "Threads"
    Given the DatasetMappingPreview component is rendered
    When the user views the mapping toggle tabs
    Then the thread tab label is "Thread"
