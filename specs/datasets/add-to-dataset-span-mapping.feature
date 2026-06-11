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
  # The same trace-only limitation applied to the "evaluations" and "events"
  # sources: their dropdowns only listed evaluators / event types present on the
  # open trace, so ones that occurred elsewhere in the project could not be
  # mapped. They now also draw from the project's last 30 days.
  #
  # Evaluator names come from the same getDistinctFieldNames query as spans and
  # metadata. Event types come from a separate, bounded source (the analytics
  # event-type filter options) because they live only inside the heavy
  # stored_spans span-attributes map, which that query must not scan.

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

  Scenario: The span name dropdown is searchable for large projects
    Given my project has so many span names that scanning the list is slow
    When I select "spans" as the source for a column
    And I type part of a span name into the dropdown
    Then the dropdown filters down to the matching span names

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
  # Evaluations and events also offer project-wide names, not just the open trace's
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

  Scenario: Event types from the project are offered even when absent from the open trace
    Given an event of type "thumbs_up" was tracked somewhere in my project in the last 30 days
    And the trace I opened the "Add to Dataset" drawer on has no such event
    When I select "events" as the source for a column
    Then "thumbs_up" is offered as an event type to map

  # ============================================================================
  # Span expansion behaviour (the "One row per span" toggle). Locked because
  # saved automations persist these expansion keys; the toggle enabled means
  # "normalize / expand", producing one row per span, not one row for all spans.
  # ============================================================================

  Scenario: Expanding spans produces one dataset row per span
    Given a trace with three spans mapped with the spans source
    And the "One row per span" expansion is enabled
    When the trace is converted to dataset rows
    Then it produces three rows, one per span

  Scenario: Without the span expansion the trace stays a single row
    Given a trace with three spans mapped with the spans source
    And no expansion is enabled
    When the trace is converted to dataset rows
    Then it produces a single row whose spans field is the array of all spans

  # ============================================================================
  # The mapping preview stays readable for heavy values. Mapping a span-heavy
  # trace (for example a hundred spans serialized to JSON) into a column used to
  # dump the whole blob into the cell, making the preview unreadable and slow.
  # The cell now shows a capped value and the full value opens on double-click.
  # ============================================================================

  Scenario: A heavy mapped value is capped in the preview cell
    Given a column is mapped to a value far larger than the cell can show
    When the mapping preview renders that row
    Then the cell shows a truncated value, not the entire blob

  Scenario: Double-clicking a preview cell expands the full value
    Given a preview cell holds a value too large to read inline
    When I double-click that cell
    Then the full untruncated value opens in an expanded dialog

  Scenario: Selecting a single preview row toggles only that row
    Given the mapping preview lists rows with selection checkboxes
    When I check the checkbox for one row
    Then only that row's selection is toggled

  Scenario: The header checkbox toggles every preview row
    Given the mapping preview lists rows with selection checkboxes
    When I check the header select-all checkbox
    Then every row's selection is toggled

  Scenario: Bulk-selecting more than twenty traces still opens the preview
    Given I selected twenty-five traces in the traces table
    When I open the "Add to Dataset" drawer
    Then the mapping preview loads rows for all twenty-five traces
