Feature: Prompt runtime parameters
  As a developer migrating prompts from Langfuse
  I want each prompt version to carry a JSON runtime parameters
  So that workflow parameters travel with the prompt version returned by LangWatch

  Background:
    Given I am authenticated in project "my-project"

  @integration
  Scenario: Creating a prompt stores the supplied runtime parameters
    When I create a prompt "search-agent" with parameters {"search_iterations": 3, "confidence_threshold": 0.85}
    Then the created prompt response contains version 1
    And the created prompt response contains parameters {"search_iterations": 3, "confidence_threshold": 0.85}

  @integration
  Scenario: Creating a prompt without runtime parameters returns an empty parameters object
    When I create a prompt "plain-agent" without a parameters field
    Then the created prompt response contains parameters {}

  @integration @unimplemented
  Scenario: Rejecting non-object runtime parameters values
    When I create a prompt "invalid-agent" with parameters ["not", "an", "object"]
    Then the platform rejects the request
    And the validation error identifies parameters as an object field

  @integration
  Scenario: Updating only runtime parameters creates a new prompt version
    Given prompt "search-agent" has version 1 with parameters {"search_iterations": 3}
    When I update "search-agent" with parameters {"search_iterations": 5} and commit message "Tune search"
    Then the prompt response contains version 2
    And the prompt response contains parameters {"search_iterations": 5}

  @integration
  Scenario: Updating prompt content without runtime parameters preserves the previous parameters
    Given prompt "search-agent" has version 1 with parameters {"confidence_threshold": 0.9}
    When I update "search-agent" with new prompt content and no parameters field
    Then the prompt response contains version 2
    And the prompt response contains parameters {"confidence_threshold": 0.9}

  @integration
  Scenario: Fetching prompts returns the selected version parameters
    Given prompt "search-agent" has version 1 with parameters {"environment": "production"}
    And prompt "search-agent" has version 2 with parameters {"environment": "staging"}
    And version 1 is tagged "production"
    When I fetch "search-agent" by tag "production"
    Then the prompt response contains version 1
    And the prompt response contains parameters {"environment": "production"}
    When I fetch "search-agent" by version 2
    Then the prompt response contains version 2
    And the prompt response contains parameters {"environment": "staging"}

  @integration
  Scenario: Listing prompt versions returns each version parameters
    Given prompt "search-agent" has version 1 with parameters {"schema": "v1"}
    And prompt "search-agent" has version 2 with parameters {"schema": "v2"}
    When I list versions for "search-agent"
    Then version 1 contains parameters {"schema": "v1"}
    And version 2 contains parameters {"schema": "v2"}

  @integration
  Scenario: Restoring a prompt version carries forward that version parameters
    Given prompt "search-agent" has version 1 with parameters {"restored": true}
    And prompt "search-agent" has version 2 with parameters {"restored": false}
    When I restore version 1 of "search-agent"
    Then the new prompt version contains parameters {"restored": true}

  @integration @unimplemented
  Scenario: Copying a prompt carries its runtime parameters to the target project
    Given prompt "search-agent" has latest parameters {"copied": true}
    When I copy "search-agent" to project "target-project"
    Then the copied prompt contains parameters {"copied": true}

  @integration
  Scenario: Syncing a local prompt includes runtime parameters in the remote version
    Given my local prompt file for "search-agent" contains parameters {"local": true}
    When I sync the local prompt
    Then the remote prompt version contains parameters {"local": true}

  @integration
  Scenario: Syncing a local prompt detects runtime parameters conflicts
    Given the remote prompt "search-agent" has parameters {"remote": true}
    And my local prompt file for "search-agent" has the same version with parameters {"local": true}
    When I sync the local prompt
    Then the sync result reports a conflict
    And the conflict payload includes the remote parameters {"remote": true}

  @integration @unimplemented
  Scenario: Prompt editor saves runtime parameters from a JSON editor
    Given I am editing prompt "search-agent"
    When I enter parameters {"output_schema": {"type": "object"}, "enabled": true} in the Runtime Parameters section
    And I save a new version
    Then the saved version contains parameters {"output_schema": {"type": "object"}, "enabled": true}

  @integration @unimplemented
  Scenario: Prompt editor blocks invalid runtime parameters JSON
    Given I am editing prompt "search-agent"
    When I enter invalid JSON in the Runtime Parameters section
    Then the editor shows a parameters validation error
    And I cannot save the version

  @integration @unimplemented
  Scenario: Prompt playground shows runtime parameters as read-only version data
    Given prompt "search-agent" has latest parameters {"readonly": true}
    When I view "search-agent" in the prompt playground
    Then the Config tab displays {"readonly": true}

  @unit @unimplemented
  Scenario: Runtime parameters validation accepts object JSON values
    When parameters validation runs for {"nested": {"array": [1, true, {"leaf": "value"}]}}
    Then validation succeeds

  @unit @unimplemented
  Scenario: Runtime parameters validation rejects non-object root values
    When parameters validation runs for null, an array, a string, a number, or a boolean
    Then validation fails for each value

  @unit @unimplemented
  Scenario: Prompt form values preserve runtime parameters during API mapping
    Given an API prompt version contains parameters {"mapped": true}
    When it is converted to prompt form values and back to an update payload
    Then the update payload contains parameters {"mapped": true}

  @unit @unimplemented
  Scenario: TypeScript local prompt files preserve runtime parameters
    Given a local prompt file contains parameters {"cli": true}
    When the TypeScript CLI parses and materializes the prompt
    Then the materialized prompt contains parameters {"cli": true}

  @unit @unimplemented
  Scenario: Python prompt models expose runtime parameters
    Given the prompt API returns parameters {"sdk": true}
    When the Python SDK creates PromptData from the response
    Then PromptData.parameters equals {"sdk": true}

  @unit @unimplemented
  Scenario: Python prompt API writes runtime parameters on create and update
    When the Python SDK creates or updates a prompt with parameters {"sdk_write": true}
    Then the prompt API request includes parameters {"sdk_write": true}
