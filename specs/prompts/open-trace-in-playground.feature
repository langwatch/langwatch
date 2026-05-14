Feature: Open trace in Playground
  As a user viewing a trace
  I want to open it in the Prompt Playground
  So that I can iterate on the prompt used in the traced LLM call

  # All 3 remaining @unimplemented scenarios are KEEP per AUDIT_MANIFEST.md:
  # the LLM_PARAMETER_MAP loop in clickhouse-trace.service.ts and
  # elasticsearch-trace.service.ts extracts all gen_ai.request.* params plus
  # routes unknown keys into litellmParams, but no integration test exercises
  # the ClickHouse or Elasticsearch path end-to-end with these attributes.
  # All other parameter-coercion / unset-handling scenarios are covered by
  # useLoadSpanIntoPromptPlayground.unit.test.ts. Aspirational pending KEEP-class
  # backend-integration tests tracked in PR #3458.

  Background:
    Given a project with traced LLM calls

  # --- Existing: basic null-to-undefined coercion ---

  @integration @unimplemented
  Scenario: ClickHouse backend extracts all OTel gen_ai.request attributes
    Given a span stored in ClickHouse with gen_ai.request.* attributes for all supported parameters
    When the getForPromptStudio API is called
    Then all parameters are returned in the llmConfig response

  @integration @unimplemented
  Scenario: Elasticsearch backend extracts all parameters from span params
    Given a span stored in Elasticsearch with LLM params for all supported parameters
    When the getForPromptStudio API is called
    Then all parameters are returned in the llmConfig response

  @integration @unimplemented
  Scenario: Extra unknown parameters from traces go into litellmParams
    Given a span with non-standard parameters like custom_param or vendor_specific_setting
    When the getForPromptStudio API is called
    Then unknown parameters appear in litellmParams
    And known parameters appear in their dedicated fields
