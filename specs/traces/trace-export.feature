@integration
Feature: Trace export with depth options
  As a LangWatch user on the Messages page
  I want to export traces with configurable depth (summary or full with spans)
  So that I can use trace data for debugging, data analysis, and BI workflows

  Background:
    Given I am on the Messages page in table view
    And my project has traces with spans, evaluations, and metadata

  # ============================================================================
  # Summary Mode Export (CSV)
  # ============================================================================

  @unimplemented
  Scenario: Summary CSV exports one row per trace
    Given the export config dialog is open with mode "Summary" and format "CSV"
    When I click "Export"
    Then a CSV file is downloaded
    And each trace is a single row
    And the CSV contains columns: trace_id, timestamp, input, output, labels, first_token_ms, total_time_ms, prompt_tokens, completion_tokens, total_cost, metadata, topic, subtopic

  @unimplemented
  Scenario: Summary CSV includes evaluation columns with scores and details
    Given traces have evaluations from evaluators "Faithfulness" and "Relevance"
    And the export config dialog is open with mode "Summary" and format "CSV"
    When I click "Export"
    Then the CSV contains columns: Faithfulness_score, Faithfulness_passed, Faithfulness_details
    And the CSV contains columns: Relevance_score, Relevance_passed, Relevance_details

  # ============================================================================
  # Full Mode Export (CSV)
  # ============================================================================

  @unimplemented
  Scenario: Full CSV includes LLM span details
    Given a trace has an LLM span with model "gpt-4o" and vendor "openai"
    And the span has chat_messages input and text output
    And the export config dialog is open with mode "Full" and format "CSV"
    When I click "Export"
    Then the LLM span row has span_model "gpt-4o" and span_vendor "openai"
    And span_input contains the stringified chat messages JSON
    And span_output contains the output text

  @unimplemented
  Scenario: Full CSV includes RAG context fields
    Given a trace has a RAG span with retrieved document chunks
    And the export config dialog is open with mode "Full" and format "CSV"
    When I click "Export"
    Then the RAG span row has a span_contexts column
    And span_contexts contains JSON with document_id, chunk_id, and content

  @unimplemented
  Scenario: Full CSV includes span timing and token metrics
    Given a trace has an LLM span with duration 1200ms, 500 prompt tokens, 150 completion tokens, and cost $0.003
    And the export config dialog is open with mode "Full" and format "CSV"
    When I click "Export"
    Then the span row has span_duration_ms "1200"
    And the span row has span_prompt_tokens "500"
    And the span row has span_completion_tokens "150"
    And the span row has span_cost "0.003"

  @unimplemented
  Scenario: Full CSV includes evaluation columns per evaluator
    Given traces have evaluations from evaluator "Toxicity" with score 0.95, passed true, and details "No toxic content detected"
    And the export config dialog is open with mode "Full" and format "CSV"
    When I click "Export"
    Then each row includes Toxicity_score "0.95", Toxicity_passed "true", Toxicity_details "No toxic content detected"

  # ============================================================================
  # Filters and Scope
  # ============================================================================

  @unimplemented
  Scenario: Export respects active time range filter
    Given I have filtered traces to the last 7 days
    And the export config dialog is open
    When I click "Export"
    Then only traces from the last 7 days are included in the download

  @unimplemented
  Scenario: Export respects label filter
    Given I have filtered traces by label "production"
    And the export config dialog is open
    When I click "Export"
    Then only traces with label "production" are included in the download

  @unimplemented
  Scenario: Export respects evaluation status filter
    Given I have filtered traces to show only those where "Faithfulness" passed
    And the export config dialog is open
    When I click "Export"
    Then only traces where Faithfulness evaluation passed are included

  @unimplemented
  Scenario: Export selected traces ignores table filters for unselected
    Given I have selected 3 specific traces
    And a time range filter is active
    When I click "Export" from the floating toolbar
    Then exactly those 3 traces are exported regardless of other filters

  # ============================================================================
  # Streaming Download and Progress
  # ============================================================================

  @unimplemented
  Scenario: Export completes with correct file name
    Given my project ID is "my-project-123"
    And today's date is "2026-03-16"
    And the export config dialog is open with mode "Full" and format "CSV"
    When I click "Export"
    Then the downloaded file is named "my-project-123 - Traces - 2026-03-16 - full.csv"

  @unimplemented
  Scenario: Export completes with JSONL file name for JSON format
    Given the export config dialog is open with mode "Summary" and format "JSON"
    When I click "Export"
    Then the downloaded file has extension ".jsonl"

  # ============================================================================
  # CSV Special Characters and Edge Cases
  # ============================================================================

  @unimplemented
  Scenario: CSV handles special characters in trace input/output
    Given a trace has input containing commas, quotes, and newlines
    When I export in Summary CSV mode
    Then special characters are properly escaped
    And the CSV can be opened correctly in spreadsheet software

  @unimplemented
  Scenario: CSV handles empty spans gracefully
    Given a trace has a span with null input and null output
    When I export in Full CSV mode
    Then the span row has empty values for span_input and span_output
    And the CSV is still valid

  @unimplemented
  Scenario: Export handles traces with no evaluations
    Given a trace has no evaluations
    When I export in Full CSV mode
    Then evaluation columns are present but empty for that trace's rows

  # ============================================================================
  # Export Limits
  # ============================================================================

  @unimplemented
  Scenario: Export respects the 10,000 trace limit
    Given my project has 15,000 matching traces
    And the export config dialog is open
    Then the dialog shows "10,000 traces (limit)"
    When I click "Export"
    Then 10,000 traces are exported

  # ============================================================================
  # Authorization
  # ============================================================================

  @unimplemented
  Scenario: Export requires traces:view permission
    Given I do not have the "traces:view" permission for this project
    When I attempt to export traces
    Then the export is denied with an authorization error
