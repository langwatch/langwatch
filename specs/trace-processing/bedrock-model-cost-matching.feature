Feature: Bedrock model id cost matching
  As a LangWatch user tracing LLM calls made through AWS Bedrock
  I want spans reporting any spelling of a Bedrock model id
  To resolve the platform's registry pricing for the underlying model
  So that Bedrock traffic is costed without needing a custom cost row per project

  # Background
  #
  # Bedrock identifies models as [<region>.]<vendor>.<model>[-v<N>][:<version>],
  # e.g. eu.anthropic.claude-sonnet-4-6 or anthropic.claude-haiku-4-5-20251001-v1:0.
  # The pricing registry keys models as <vendor>/<model>. Matching strips the
  # Bedrock envelope (region prefix, revision/version suffixes, vendor-dot
  # notation) to land on the registry key.
  #
  # litellm-style clients report the model id WITH a "bedrock/" provider
  # prefix (bedrock/eu.anthropic.claude-sonnet-4-6). That prefix is part of
  # the same envelope and is stripped before normalization, so both spellings
  # of the same model id resolve the same registry entry.

  @unit
  Scenario: A bedrock/-prefixed regional model id resolves registry pricing
    Given the pricing registry has an entry for "anthropic/claude-sonnet-4-6"
    When the cost for model "bedrock/eu.anthropic.claude-sonnet-4-6" is matched
    Then the "anthropic/claude-sonnet-4-6" registry entry is returned

  @unit
  Scenario: A bedrock/-prefixed versioned model id resolves registry pricing
    Given the pricing registry has an entry for "anthropic/claude-haiku-4.5"
    When the cost for model "bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0" is matched
    Then the "anthropic/claude-haiku-4.5" registry entry is returned

  @unit
  Scenario: A bare regional Bedrock model id keeps resolving registry pricing
    Given the pricing registry has an entry for "anthropic/claude-sonnet-4-6"
    When the cost for model "eu.anthropic.claude-sonnet-4-6" is matched
    Then the "anthropic/claude-sonnet-4-6" registry entry is returned

  @unit
  Scenario: A custom cost regex written against the bedrock/-prefixed spelling still wins
    Given a custom cost whose regex matches "bedrock/eu.anthropic.claude-sonnet-4-6" exactly
    When the cost for model "bedrock/eu.anthropic.claude-sonnet-4-6" is matched
    Then the custom cost entry is returned, not the registry entry
