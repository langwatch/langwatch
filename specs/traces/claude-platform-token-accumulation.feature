Feature: Claude Platform traces count each token once
  The Claude API's OpenTelemetry export puts the same usage on several spans
  of one request: `anthropic.messages.create` repeats the usage of the
  `anthropic.model_request` spans under it. Anthropic's rule is to sum only
  `anthropic.model_request`, `anthropic.compaction` and
  `anthropic.session.outcome_evaluation`
  (https://platform.claude.com/docs/en/manage-claude/opentelemetry#count-tokens).

  @unit
  Scenario: The API request span's repeated usage is not summed
    Given a span from the "com.anthropic.claude-platform" scope named "anthropic.messages.create"
    And it carries token usage
    When the span is canonicalised
    Then it is marked to skip token accumulation

  @unit
  Scenario Outline: An API step span's own usage is summed
    Given a span from the "com.anthropic.claude-platform" scope named "<name>"
    And it carries token usage
    When the span is canonicalised
    Then it is not marked to skip token accumulation

    Examples:
      | name                                 |
      | anthropic.model_request              |
      | anthropic.compaction                 |
      | anthropic.session.outcome_evaluation |

  @unit
  Scenario: A Claude SDK client span keeps its usage
    Given a span from a "com.anthropic.sdk" scope named "anthropic.messages.create"
    And it carries token usage
    When the span is canonicalised
    Then it is not marked to skip token accumulation
