Feature: Prompt runtime config
  As a developer migrating prompts from Langfuse
  I want each prompt version to carry a JSON runtime config
  So that workflow parameters travel with the prompt version returned by LangWatch

  Background:
    Given I am authenticated in project "my-project"

  @integration
  Scenario: Creating a prompt stores the supplied runtime config
    When I create a prompt "search-agent" with config {"search_iterations": 3, "confidence_threshold": 0.85}
    Then the created prompt response contains version 1
    And the created prompt response contains config {"search_iterations": 3, "confidence_threshold": 0.85}

  @integration
  Scenario: Creating a prompt without runtime config returns an empty config object
    When I create a prompt "plain-agent" without a config field
    Then the created prompt response contains config {}

  @integration @unimplemented
  Scenario: Rejecting non-object runtime config values
    When I create a prompt "invalid-agent" with config ["not", "an", "object"]
    Then the platform rejects the request
    And the validation error identifies config as an object field

  @integration
  Scenario: Updating only runtime config creates a new prompt version
    Given prompt "search-agent" has version 1 with config {"search_iterations": 3}
    When I update "search-agent" with config {"search_iterations": 5} and commit message "Tune search"
    Then the prompt response contains version 2
    And the prompt response contains config {"search_iterations": 5}

  @integration
  Scenario: Updating prompt content without runtime config preserves the previous config
    Given prompt "search-agent" has version 1 with config {"confidence_threshold": 0.9}
    When I update "search-agent" with new prompt content and no config field
    Then the prompt response contains version 2
    And the prompt response contains config {"confidence_threshold": 0.9}

  @integration
  Scenario: Fetching prompts returns the selected version config
    Given prompt "search-agent" has version 1 with config {"environment": "production"}
    And prompt "search-agent" has version 2 with config {"environment": "staging"}
    And version 1 is tagged "production"
    When I fetch "search-agent" by tag "production"
    Then the prompt response contains version 1
    And the prompt response contains config {"environment": "production"}
    When I fetch "search-agent" by version 2
    Then the prompt response contains version 2
    And the prompt response contains config {"environment": "staging"}

  @integration
  Scenario: Listing prompt versions returns each version config
    Given prompt "search-agent" has version 1 with config {"schema": "v1"}
    And prompt "search-agent" has version 2 with config {"schema": "v2"}
    When I list versions for "search-agent"
    Then version 1 contains config {"schema": "v1"}
    And version 2 contains config {"schema": "v2"}

  @integration
  Scenario: Restoring a prompt version carries forward that version config
    Given prompt "search-agent" has version 1 with config {"restored": true}
    And prompt "search-agent" has version 2 with config {"restored": false}
    When I restore version 1 of "search-agent"
    Then the new prompt version contains config {"restored": true}

  @integration @unimplemented
  Scenario: Copying a prompt carries its runtime config to the target project
    Given prompt "search-agent" has latest config {"copied": true}
    When I copy "search-agent" to project "target-project"
    Then the copied prompt contains config {"copied": true}

  @integration
  Scenario: Syncing a local prompt includes runtime config in the remote version
    Given my local prompt file for "search-agent" contains config {"local": true}
    When I sync the local prompt
    Then the remote prompt version contains config {"local": true}

  @integration
  Scenario: Syncing a local prompt detects runtime config conflicts
    Given the remote prompt "search-agent" has config {"remote": true}
    And my local prompt file for "search-agent" has the same version with config {"local": true}
    When I sync the local prompt
    Then the sync result reports a conflict
    And the conflict payload includes the remote config {"remote": true}

  @integration @unimplemented
  Scenario: Prompt editor saves runtime config from a JSON editor
    Given I am editing prompt "search-agent"
    When I enter config {"output_schema": {"type": "object"}, "enabled": true} in the Runtime Config section
    And I save a new version
    Then the saved version contains config {"output_schema": {"type": "object"}, "enabled": true}

  @integration @unimplemented
  Scenario: Prompt editor blocks invalid runtime config JSON
    Given I am editing prompt "search-agent"
    When I enter invalid JSON in the Runtime Config section
    Then the editor shows a config validation error
    And I cannot save the version

  @integration @unimplemented
  Scenario: Prompt playground shows runtime config as read-only version data
    Given prompt "search-agent" has latest config {"readonly": true}
    When I view "search-agent" in the prompt playground
    Then the Config tab displays {"readonly": true}

  @unit @unimplemented
  Scenario: Runtime config validation accepts object JSON values
    When config validation runs for {"nested": {"array": [1, true, {"leaf": "value"}]}}
    Then validation succeeds

  @unit @unimplemented
  Scenario: Runtime config validation rejects non-object root values
    When config validation runs for null, an array, a string, a number, or a boolean
    Then validation fails for each value

  @unit @unimplemented
  Scenario: Prompt form values preserve runtime config during API mapping
    Given an API prompt version contains config {"mapped": true}
    When it is converted to prompt form values and back to an update payload
    Then the update payload contains config {"mapped": true}

  @unit @unimplemented
  Scenario: TypeScript local prompt files preserve runtime config
    Given a local prompt file contains config {"cli": true}
    When the TypeScript CLI parses and materializes the prompt
    Then the materialized prompt contains config {"cli": true}

  @unit @unimplemented
  Scenario: Python prompt models expose runtime config
    Given the prompt API returns config {"sdk": true}
    When the Python SDK creates PromptData from the response
    Then PromptData.config equals {"sdk": true}

  @unit @unimplemented
  Scenario: Python prompt API writes runtime config on create and update
    When the Python SDK creates or updates a prompt with config {"sdk_write": true}
    Then the prompt API request includes config {"sdk_write": true}
