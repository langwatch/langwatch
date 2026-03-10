Feature: Open trace in Playground
  As a user viewing a trace
  I want to open it in the Prompt Playground
  So that I can iterate on the prompt used in the traced LLM call

  Background:
    Given a project with traced LLM calls

  # --- Existing: basic null-to-undefined coercion ---

  @unit
  Scenario: Trace without max tokens specified opens in Playground
    Given the traced LLM call did not specify max tokens
    When I open the trace in the Playground
    Then the Playground loads without validation errors
    And max tokens is left unset

  @unit
  Scenario: Trace without temperature specified opens in Playground
    Given the traced LLM call did not specify temperature
    When I open the trace in the Playground
    Then the Playground loads without validation errors
    And temperature is left unset

  @unit
  Scenario: Trace with LLM config values opens in Playground with those values
    Given the traced LLM call used max tokens of 1024
    And the traced LLM call used temperature of 0.7
    When I open the trace in the Playground
    Then the Playground loads without validation errors
    And max tokens shows 1024
    And temperature shows 0.7

  @unit
  Scenario: Trace without a model specified uses the default model
    Given the traced LLM call did not specify a model
    When I open the trace in the Playground
    Then the Playground loads with the default model

  # --- Dynamic parameter mapping from trace to playground ---

  # The trace-to-playground bridge should extract ALL known LLM parameters
  # from trace data — not just temperature/maxTokens/topP. Parameters come
  # from OTel GenAI semantic conventions (gen_ai.request.*) and are stored
  # as span attributes. The bridge uses a declarative parameter map to
  # convert trace attribute names → playground form field names with the
  # appropriate type coercion (number or string).
  #
  # The playground form schema already supports all these parameters.
  # The model registry (llmModels.json + custom models) defines which
  # parameters each model supports — the UI uses that to show/hide controls,
  # but the bridge should extract everything available from the trace
  # regardless of model support.

  @unit
  Scenario: Trace with all OTel numeric parameters maps them to the playground
    Given the traced LLM call includes frequency_penalty, presence_penalty, seed, top_k, min_p, and repetition_penalty
    When I open the trace in the Playground
    Then all numeric parameters are populated in the playground form
    And no validation errors occur

  @unit
  Scenario: Trace with reasoning effort maps it to the playground
    Given the traced LLM call includes a reasoning effort parameter
    When I open the trace in the Playground
    Then the reasoning parameter is populated in the playground form

  @unit
  Scenario: Trace with string-typed numeric parameters coerces them
    Given the traced LLM call has temperature as string "0.7"
    And the traced LLM call has max_tokens as string "2048"
    And the traced LLM call has frequency_penalty as string "0.5"
    When I open the trace in the Playground
    Then all values are coerced to their correct numeric types

  @unit
  Scenario: Trace with unknown or garbage parameter values skips them gracefully
    Given the traced LLM call has temperature as an object
    And the traced LLM call has frequency_penalty as boolean true
    And the traced LLM call has seed as string "not-a-number"
    When I open the trace in the Playground
    Then the Playground loads without validation errors
    And uncoercible parameters are left unset

  @unit
  Scenario: Trace with only some parameters populates only those
    Given the traced LLM call specifies only temperature and seed
    When I open the trace in the Playground
    Then temperature and seed are populated
    And all other parameters are left unset

  # --- Backend extraction: ClickHouse and Elasticsearch ---

  @integration
  Scenario: ClickHouse backend extracts all OTel gen_ai.request attributes
    Given a span stored in ClickHouse with gen_ai.request.* attributes for all supported parameters
    When the getForPromptStudio API is called
    Then all parameters are returned in the llmConfig response

  @integration
  Scenario: Elasticsearch backend extracts all parameters from span params
    Given a span stored in Elasticsearch with LLM params for all supported parameters
    When the getForPromptStudio API is called
    Then all parameters are returned in the llmConfig response

  @integration
  Scenario: Extra unknown parameters from traces go into litellmParams
    Given a span with non-standard parameters like custom_param or vendor_specific_setting
    When the getForPromptStudio API is called
    Then unknown parameters appear in litellmParams
    And known parameters appear in their dedicated fields
