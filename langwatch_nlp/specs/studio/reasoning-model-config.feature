Feature: Reasoning Model LLM Configuration
  As a user running evaluations with reasoning models (GPT-5, o1, o3)
  I want the system to auto-correct invalid temperature and max_tokens values
  So that DSPy doesn't crash with "reasoning models require temperature=1.0"

  Background:
    Given reasoning models are identified by pattern "o1|o3|gpt-5" (case-insensitive)
    And reasoning models require temperature=1.0 and max_tokens >= 16000

  # Unit: Pure logic in utils.py

  @unit
  Scenario: Auto-correct temperature for reasoning model with invalid value
    Given an LLM config with model "openai/gpt-5"
    And temperature is 0.5
    When creating a DSPy LM instance
    Then temperature should be 1.0

  @unit
  Scenario: Auto-correct temperature for reasoning model with undefined value
    Given an LLM config with model "openai/gpt-5"
    And temperature is undefined
    When creating a DSPy LM instance
    Then temperature should be 1.0

  @unit
  Scenario: Auto-correct max_tokens for reasoning model below minimum
    Given an LLM config with model "openai/o1"
    And max_tokens is 2048
    When creating a DSPy LM instance
    Then max_tokens should be 16000

  @unit
  Scenario: Auto-correct max_tokens for reasoning model with undefined value
    Given an LLM config with model "openai/o3"
    And max_tokens is undefined
    When creating a DSPy LM instance
    Then max_tokens should be 16000

  @unit
  Scenario: Preserve valid config for reasoning model
    Given an LLM config with model "openai/gpt-5"
    And temperature is 1.0
    And max_tokens is 32000
    When creating a DSPy LM instance
    Then temperature should be 1.0
    And max_tokens should be 32000

  @unit
  Scenario: Non-reasoning model config unchanged
    Given an LLM config with model "openai/gpt-4o"
    And temperature is 0.5
    And max_tokens is 2048
    When creating a DSPy LM instance
    Then temperature should be 0.5
    And max_tokens should be 2048

  @unit
  Scenario: Non-reasoning model with undefined values uses defaults
    Given an LLM config with model "openai/gpt-4o"
    And temperature is undefined
    And max_tokens is undefined
    When creating a DSPy LM instance
    Then temperature should be 0
    And max_tokens should be 2048
