@integration
Feature: Trace export with depth options
  As a LangWatch user on the Messages page
  I want to export traces with configurable depth (summary or full with spans)
  So that I can use trace data for debugging, data analysis, and BI workflows

  Background:
    Given I am on the Messages page in table view
    And my project has traces with spans, evaluations, and metadata

  # ============================================================================
  # Export Config Dialog
  # ============================================================================

  Scenario: Export All button opens the config dialog
    When I click the "Export all" button in the page header
    Then an export config dialog appears
    And the dialog shows the total number of matching traces
    And the mode defaults to "Summary"
    And the format defaults to "CSV"

  Scenario: Export Selected button opens the config dialog scoped to selection
    Given I have selected 5 traces in the table
    When I click the "Export" button in the floating toolbar
    Then an export config dialog appears
    And the dialog shows "5 selected traces"

  Scenario: Toggle between Summary and Full mode
    Given the export config dialog is open
    When I select "Full" mode
    Then the dialog indicates that spans and evaluations will be included
    When I select "Summary" mode
    Then the dialog indicates that only trace-level fields will be exported

  Scenario: Toggle between CSV and JSON format
    Given the export config dialog is open
    When I select "JSON" format
    Then the dialog indicates the file will be JSONL
    When I select "CSV" format
    Then the dialog indicates the file will be CSV

  # ============================================================================
  # Summary Mode Export (CSV)
  # ============================================================================

  Scenario: Summary CSV exports one row per trace
    Given the export config dialog is open with mode "Summary" and format "CSV"
    When I click "Export"
    Then a CSV file is downloaded
    And each trace is a single row
    And the CSV contains columns: trace_id, timestamp, input, output, labels, first_token_ms, total_time_ms, prompt_tokens, completion_tokens, total_cost, metadata, topic, subtopic

  Scenario: Summary CSV includes evaluation columns with scores and details
    Given traces have evaluations from evaluators "Faithfulness" and "Relevance"
    And the export config dialog is open with mode "Summary" and format "CSV"
    When I click "Export"
    Then the CSV contains columns: Faithfulness_score, Faithfulness_passed, Faithfulness_details
    And the CSV contains columns: Relevance_score, Relevance_passed, Relevance_details

  # ============================================================================
  # Full Mode Export (CSV)
  # ============================================================================

  Scenario: Full CSV exports one row per span with trace fields denormalized
    Given a trace has 3 spans (1 chain, 1 LLM, 1 tool)
    And the export config dialog is open with mode "Full" and format "CSV"
    When I click "Export"
    Then the CSV contains 3 rows for that trace
    And each row includes trace-level fields: trace_id, trace_timestamp, trace_input, trace_output, trace_total_cost
    And each row includes span-level fields: span_id, parent_span_id, span_type, span_name

  Scenario: Full CSV includes LLM span details
    Given a trace has an LLM span with model "gpt-4o" and vendor "openai"
    And the span has chat_messages input and text output
    And the export config dialog is open with mode "Full" and format "CSV"
    When I click "Export"
    Then the LLM span row has span_model "gpt-4o" and span_vendor "openai"
    And span_input contains the stringified chat messages JSON
    And span_output contains the output text

  Scenario: Full CSV includes RAG context fields
    Given a trace has a RAG span with retrieved document chunks
    And the export config dialog is open with mode "Full" and format "CSV"
    When I click "Export"
    Then the RAG span row has a span_contexts column
    And span_contexts contains JSON with document_id, chunk_id, and content

  Scenario: Full CSV includes span timing and token metrics
    Given a trace has an LLM span with duration 1200ms, 500 prompt tokens, 150 completion tokens, and cost $0.003
    And the export config dialog is open with mode "Full" and format "CSV"
    When I click "Export"
    Then the span row has span_duration_ms "1200"
    And the span row has span_prompt_tokens "500"
    And the span row has span_completion_tokens "150"
    And the span row has span_cost "0.003"

  Scenario: Full CSV includes evaluation columns per evaluator
    Given traces have evaluations from evaluator "Toxicity" with score 0.95, passed true, and details "No toxic content detected"
    And the export config dialog is open with mode "Full" and format "CSV"
    When I click "Export"
    Then each row includes Toxicity_score "0.95", Toxicity_passed "true", Toxicity_details "No toxic content detected"

  # ============================================================================
  # JSON / JSONL Export
  # ============================================================================

  Scenario: Summary JSON exports one JSON object per trace
    Given the export config dialog is open with mode "Summary" and format "JSON"
    When I click "Export"
    Then a JSONL file is downloaded
    And each line is a valid JSON object with trace-level fields
    And spans are not included in the output

  Scenario: Full JSON exports nested trace objects with spans
    Given a trace has 3 spans and 2 evaluations
    And the export config dialog is open with mode "Full" and format "JSON"
    When I click "Export"
    Then a JSONL file is downloaded
    And each line is a JSON object containing a "spans" array with 3 items
    And each line contains an "evaluations" array with 2 items

  # ============================================================================
  # Filters and Scope
  # ============================================================================

  Scenario: Export respects active time range filter
    Given I have filtered traces to the last 7 days
    And the export config dialog is open
    When I click "Export"
    Then only traces from the last 7 days are included in the download

  Scenario: Export respects label filter
    Given I have filtered traces by label "production"
    And the export config dialog is open
    When I click "Export"
    Then only traces with label "production" are included in the download

  Scenario: Export respects evaluation status filter
    Given I have filtered traces to show only those where "Faithfulness" passed
    And the export config dialog is open
    When I click "Export"
    Then only traces where Faithfulness evaluation passed are included

  Scenario: Export selected traces ignores table filters for unselected
    Given I have selected 3 specific traces
    And a time range filter is active
    When I click "Export" from the floating toolbar
    Then exactly those 3 traces are exported regardless of other filters

  # ============================================================================
  # Streaming Download and Progress
  # ============================================================================

  Scenario: Progress bar appears during export
    Given I start an export of 500 traces
    Then a progress indicator appears showing "Exported 0 of 500 traces"
    And the progress updates as batches complete
    And the progress reaches "Exported 500 of 500 traces" when the download finishes

  Scenario: Large export streams without blocking the UI
    Given I start an export of 5,000 traces in Full mode
    Then the Messages page remains interactive while the export streams
    And I can continue browsing traces during the download

  Scenario: Export completes with correct file name
    Given my project ID is "my-project-123"
    And today's date is "2026-03-16"
    And the export config dialog is open with mode "Full" and format "CSV"
    When I click "Export"
    Then the downloaded file is named "my-project-123 - Traces - 2026-03-16 - full.csv"

  Scenario: Export completes with JSONL file name for JSON format
    Given the export config dialog is open with mode "Summary" and format "JSON"
    When I click "Export"
    Then the downloaded file has extension ".jsonl"

  # ============================================================================
  # CSV Special Characters and Edge Cases
  # ============================================================================

  Scenario: CSV handles special characters in trace input/output
    Given a trace has input containing commas, quotes, and newlines
    When I export in Summary CSV mode
    Then special characters are properly escaped
    And the CSV can be opened correctly in spreadsheet software

  Scenario: CSV handles empty spans gracefully
    Given a trace has a span with null input and null output
    When I export in Full CSV mode
    Then the span row has empty values for span_input and span_output
    And the CSV is still valid

  Scenario: Export handles traces with no evaluations
    Given a trace has no evaluations
    When I export in Full CSV mode
    Then evaluation columns are present but empty for that trace's rows

  # ============================================================================
  # Export Limits
  # ============================================================================

  Scenario: Export respects the 10,000 trace limit
    Given my project has 15,000 matching traces
    And the export config dialog is open
    Then the dialog shows "10,000 traces (limit)"
    When I click "Export"
    Then 10,000 traces are exported

  # ============================================================================
  # Authorization
  # ============================================================================

  Scenario: Export requires traces:view permission
    Given I do not have the "traces:view" permission for this project
    When I attempt to export traces
    Then the export is denied with an authorization error
