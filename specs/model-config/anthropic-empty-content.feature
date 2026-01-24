Feature: Anthropic Empty Content Block Handling
  As a developer using LangWatch with Anthropic models
  I want empty content blocks filtered before sending to Anthropic API
  So that prompts don't fail with "text content blocks must be non-empty"

  Background:
    Given Anthropic API strictly rejects empty text content blocks
    And other providers (OpenAI, Google) are lenient with empty content

  # Issue: Anthropic rejects any message with empty content
  # Error: "text content blocks must be non-empty"

  @unit
  Scenario: Filters empty system message when instructions are empty
    Given a prompt with empty instructions ""
    When formatting messages for Anthropic
    Then the system message should be omitted

  @unit
  Scenario: Filters system message with only whitespace
    Given a prompt with instructions "   "
    When formatting messages for Anthropic
    Then the system message should be omitted

  @unit
  Scenario: Preserves non-empty system message
    Given a prompt with instructions "You are a helpful assistant"
    When formatting messages for Anthropic
    Then the system message should be included with content "You are a helpful assistant"

  @unit
  Scenario: Filters empty text content blocks from list content
    Given a message with content blocks:
      | type | text    |
      | text |         |
      | text | Hello   |
    When filtering empty content
    Then only the "Hello" text block should remain

  @unit
  Scenario: Removes message entirely if all content blocks are empty
    Given a message with content blocks:
      | type | text |
      | text |      |
      | text |      |
    When filtering empty content
    Then the message should be removed

  @unit
  Scenario: Handles mixed content types (preserves non-text blocks)
    Given a message with content blocks:
      | type  | text    |
      | text  |         |
      | image | [data]  |
    When filtering empty content
    Then only the image block should remain

  @unit
  Scenario: String content filtering
    Given a message with string content ""
    When filtering empty content
    Then the message should be removed

  @unit
  Scenario: String content with whitespace
    Given a message with string content "   "
    When filtering empty content
    Then the message should be removed

  @unit
  Scenario: Template variables rendering to empty
    Given a prompt with template "Hello {{ name }}"
    And input name=""
    When formatting messages
    Then if the rendered content is empty, filter it
