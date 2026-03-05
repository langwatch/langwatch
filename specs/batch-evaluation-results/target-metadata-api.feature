Feature: Python SDK Target Metadata API
  As a developer using the LangWatch Python SDK
  I want to log evaluation metrics with target metadata
  So that I can compare different models, prompts, and configurations

  Background:
    Given I have initialized an evaluation with langwatch.evaluation.init("my-experiment")
    And I am iterating over a dataset with evaluation.loop()

  # ============================================================================
  # Basic Target Usage
  # ============================================================================

  @unit
  Scenario: Log metric without target (backwards compatible)
    When I call evaluation.log("accuracy", index=0, score=0.95)
    Then the metric is logged successfully
    And no target is associated with this metric
    And the API payload has no targets array

  @unit
  Scenario: Log metric with target name only
    When I call evaluation.log("accuracy", index=0, score=0.95, target="gpt4-baseline")
    Then the metric is logged successfully
    And a target named "gpt4-baseline" is registered
    And the target has type "custom"

  @unit
  Scenario: Log metric with target and metadata
    When I call:
      """
      evaluation.log(
          "accuracy",
          index=0,
          score=0.95,
          target="gpt4-baseline",
          metadata={"model": "openai/gpt-4", "temperature": 0.7}
      )
      """
    Then the metric is logged successfully
    And target "gpt4-baseline" has metadata:
      | key         | value         |
      | model       | openai/gpt-4  |
      | temperature | 0.7           |

  # ============================================================================
  # Target Registration and Validation
  # ============================================================================

  @unit
  Scenario: First log with target registers it
    When I call evaluation.log("accuracy", index=0, target="my-target", metadata={"model": "gpt-4"})
    Then target "my-target" is registered with metadata {"model": "gpt-4"}

  @unit
  Scenario: Subsequent logs with same target reuse registration
    Given I previously logged with target="my-target" and metadata={"model": "gpt-4"}
    When I call evaluation.log("accuracy", index=1, target="my-target", score=0.9)
    Then the metric is logged successfully
    And the target metadata remains {"model": "gpt-4"}

  @unit
  Scenario: Subsequent logs can omit metadata
    Given I previously logged with target="my-target" and metadata={"model": "gpt-4"}
    When I call evaluation.log("accuracy", index=1, target="my-target", score=0.9)
    Then no error is raised
    And the target retains its original metadata

  @unit
  Scenario: Error when providing conflicting metadata
    Given I previously logged with target="my-target" and metadata={"model": "gpt-4"}
    When I call evaluation.log("accuracy", index=1, target="my-target", metadata={"model": "claude-3"})
    Then an error is raised with message containing:
      """
      Target 'my-target' was previously registered with different metadata.
      Original: {'model': 'gpt-4'}
      New: {'model': 'claude-3'}
      """

  @unit
  Scenario: Error includes suggestion to use different target name
    Given I previously logged with target="my-target" and metadata={"model": "gpt-4"}
    When I call evaluation.log with conflicting metadata for "my-target"
    Then the error message includes:
      """
      If you want to use different metadata, please use a different target name.
      """

  # ============================================================================
  # Multiple Targets in Same Run
  # ============================================================================

  @unit
  Scenario: Log metrics for multiple targets
    When I log metrics for different targets:
      """
      evaluation.log("accuracy", index=0, target="gpt4", metadata={"model": "openai/gpt-4"}, score=0.9)
      evaluation.log("accuracy", index=0, target="claude", metadata={"model": "anthropic/claude-3"}, score=0.85)
      """
    Then both targets are registered
    And the API payload includes both targets in the targets array

  @unit
  Scenario: Same metric name for different targets
    When I log:
      """
      evaluation.log("latency", index=0, target="gpt4", score=150)
      evaluation.log("latency", index=0, target="claude", score=200)
      """
    Then both metrics are stored
    And each is associated with its respective target

  # ============================================================================
  # Metadata Types
  # ============================================================================

  @unit
  Scenario: String metadata values
    When I call evaluation.log with metadata={"model": "gpt-4", "version": "v1.2"}
    Then metadata is stored correctly

  @unit
  Scenario: Numeric metadata values
    When I call evaluation.log with metadata={"temperature": 0.7, "max_tokens": 1000}
    Then metadata is stored correctly

  @unit
  Scenario: Boolean metadata values
    When I call evaluation.log with metadata={"use_cache": True, "streaming": False}
    Then metadata is stored correctly

  @unit
  Scenario: Mixed metadata value types
    When I call evaluation.log with metadata:
      """
      {
          "model": "gpt-4",
          "temperature": 0.7,
          "max_tokens": 1000,
          "use_cache": True
      }
      """
    Then all metadata values are stored with correct types

  # ============================================================================
  # API Payload
  # ============================================================================

  @integration
  Scenario: Targets included in batch payload
    Given I have logged metrics with 2 different targets
    When the batch is sent to the API
    Then the payload includes a "targets" array with 2 entries
    And each target entry has: id, name, type, metadata

  @integration
  Scenario: Target structure in payload
    Given I logged with target="my-model" and metadata={"model": "gpt-4", "temp": 0.5}
    When the batch is sent to the API
    Then the target in payload has:
      | field    | value                           |
      | id       | my-model                        |
      | name     | my-model                        |
      | type     | custom                          |
      | metadata | {"model": "gpt-4", "temp": 0.5} |

  @integration
  Scenario: Evaluations reference target_id
    Given I logged with target="my-model"
    When the batch is sent to the API
    Then each evaluation entry has target_id="my-model"

  # ============================================================================
  # Backwards Compatibility
  # ============================================================================

  @integration
  Scenario: Mixed target and no-target logs in same run
    When I log:
      """
      evaluation.log("metric1", index=0, score=0.9)  # No target
      evaluation.log("metric2", index=0, target="gpt4", score=0.85)  # With target
      """
    Then both metrics are stored
    And metric1 has no target_id
    And metric2 has target_id="gpt4"

  @integration
  Scenario: Old SDK version without target support
    Given the SDK version does not support targets
    When evaluation.log is called without target parameter
    Then the API accepts the payload
    And no targets array is included

  # ============================================================================
  # Edge Cases
  # ============================================================================

  @unit
  Scenario: Empty metadata object
    When I call evaluation.log with target="my-target" and metadata={}
    Then the target is registered with empty metadata
    And no error is raised

  @unit
  Scenario: None metadata
    When I call evaluation.log with target="my-target" and metadata=None
    Then the target is registered with no metadata
    And no error is raised

  @unit
  Scenario: Target name with special characters
    When I call evaluation.log with target="gpt-4/turbo_v2.0"
    Then the target is registered successfully
    And the name is preserved exactly

  @unit
  Scenario: Very long target name
    When I call evaluation.log with a target name of 500 characters
    Then an appropriate error or truncation occurs

  # ============================================================================
  # Custom Type Override
  # ============================================================================

  @unit
  Scenario: Override target type via metadata
    When I call evaluation.log with target="my-llm" and metadata={"type": "prompt"}
    Then the target type is set to "prompt" (not "custom")
    And the "type" key is removed from metadata

  @unit
  Scenario: Invalid type in metadata is rejected
    When I call evaluation.log with target="my-target" and metadata={"type": "invalid_type"}
    Then an error is raised with message containing:
      """
      Invalid target type 'invalid_type'. Must be one of: prompt, agent, custom
      """

  @unit
  Scenario: Valid type values in metadata
    When I call evaluation.log with metadata containing type
    Then only these type values are accepted:
      | type   |
      | prompt |
      | agent  |
      | custom |
