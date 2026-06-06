Feature: Span field mapping when adding traces to a dataset
  As a user mapping trace data into a dataset
  I want the "spans" field to offer every span name my project has produced
  So that I can map any span, even one that is not in the trace currently open

  # Context: the "Add to Dataset" drawer lets users map a trace field to a
  # dataset column. For the "spans" source a nested dropdown lists the span
  # names to choose from. Historically that list was built only from the spans
  # of the currently loaded trace(s), and the server-side queries that feed the
  # project-wide name list silently capped their results. A customer reported a
  # span name that clearly exists on a recent trace not being offered for
  # mapping. These scenarios pin the expected behaviour so it cannot regress.
  #
  # The same trace-only limitation applied to the "evaluations" source: its
  # dropdown only listed evaluators present on the open trace, so an evaluator
  # that ran elsewhere in the project could not be mapped. It now also draws
  # from the project's last 30 days, mirroring spans and metadata.
  #
  # The "events" source stays trace-derived on purpose: event types live only
  # inside the heavy stored_spans span-attributes map, so a project-wide scan
  # would not be memory-safe.

  Background:
    Given I am on a project that has produced traces over the last 30 days

  # ============================================================================
  # The dropdown offers all project span names, not just the open trace's spans
  # ============================================================================

  Scenario: Span names from the project are offered even when absent from the open trace
    Given a span named "Research.aexecute_stream" was produced somewhere in my project in the last 30 days
    And the trace I opened the "Add to Dataset" drawer on does not contain that span
    When I select "spans" as the source for a column
    Then "Research.aexecute_stream" is offered as a span name to map

  Scenario: Span names from the open trace are always offered
    Given the trace I opened the "Add to Dataset" drawer on contains a span named "step_2a_research_iter1"
    When I select "spans" as the source for a column
    Then "step_2a_research_iter1" is offered as a span name to map

  Scenario: Selecting a project span name lets me map its subfields
    Given a span named "Research.aexecute_stream" exists in my project but not in the open trace
    When I select "spans" as the source and choose "Research.aexecute_stream"
    Then I can map its input, output, params and contexts subfields

  # ============================================================================
  # Server never silently truncates the available names or spans
  # ============================================================================

  Scenario: All distinct span names are returned even for projects with thousands of them
    Given my project has more than one thousand distinct span names in the last 30 days
    When the available span names are fetched for mapping
    Then every distinct span name is returned, none are dropped

  Scenario: All metadata keys are returned even for projects with thousands of them
    Given my project has more than one thousand distinct metadata keys in the last 30 days
    When the available metadata keys are fetched for mapping
    Then every distinct metadata key is returned, none are dropped

  Scenario: A trace with many spans exposes all of its spans
    Given a single trace contains more than two hundred spans
    When that trace is loaded with its spans for mapping
    Then all of its spans are returned, none are dropped

  # ============================================================================
  # Evaluations also offer project-wide names, not just the open trace's
  # ============================================================================

  Scenario: Evaluator names from the project are offered even when absent from the open trace
    Given an evaluator named "PII Check" ran somewhere in my project in the last 30 days
    And the trace I opened the "Add to Dataset" drawer on was not scored by that evaluator
    When I select "evaluations" as the source for a column
    Then "PII Check" is offered as an evaluation to map

  Scenario: Selecting a project evaluator lets me map its result subfields
    Given an evaluator ran in my project but not on the open trace
    When I select "evaluations" as the source and choose that evaluator
    Then I can map its passed, score, label, details, status and error subfields

  Scenario: All distinct evaluator names are returned even for projects with thousands of them
    Given my project has more than one thousand distinct evaluator names in the last 30 days
    When the available evaluator names are fetched for mapping
    Then every distinct evaluator name is returned, none are dropped
