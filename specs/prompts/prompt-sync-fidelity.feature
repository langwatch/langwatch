Feature: Prompt sync fidelity between the platform and local YAML
  As a developer versioning prompts with the LangWatch Prompts CLI
  I want a prompt to survive a full push/pull round-trip without losing or
  gaining fields
  So that what I edit on the platform is exactly what I get back locally,
  and what I get back locally still runs against the model provider

  Background:
    Given a project with the Prompts CLI configured

  # --- Structured outputs survive a pull (the headline bug) ---

  @unit
  Scenario: Pulling a prompt with a JSON-schema output reconstructs response_format
    Given a remote prompt whose outputs contain a json_schema entry "picnic_category"
    When the prompt is materialized to local YAML
    Then the YAML contains a response_format block with name "picnic_category"
    And the response_format schema equals the json_schema of that output

  @unit
  Scenario: Pulling a prompt with flat structured-output fields synthesizes a single-level JSON schema
    Given a remote prompt whose outputs are flat fields "l1", "l2", "l3", "reasoning"
    When the prompt is materialized to local YAML
    Then the YAML response_format schema is an object with properties "l1", "l2", "l3", "reasoning"
    And every flat field is listed as required
    And the schema sets additionalProperties to false

  @unit
  Scenario: Pulling a plain text prompt does not invent a response_format
    Given a remote prompt whose only output is the default "output" string field
    When the prompt is materialized to local YAML
    Then the YAML contains no response_format block

  @unit
  Scenario: A response_format pushed up comes back identical on pull
    Given a local prompt with a response_format named "picnic_category"
    When the prompt is pushed and then materialized back from the API shape
    Then the materialized response_format equals the one that was pushed

  @unit
  Scenario: An object-schema response_format round-trips back to flat platform fields
    Given a local prompt whose response_format schema is an object with properties "l1", "l2", "l3", "reasoning"
    When the prompt is pushed
    Then the sync payload outputs are flat fields "l1", "l2", "l3", "reasoning"
    And no single json_schema catch-all output is sent

  # --- Sync is a pure pass-through: never fabricate, never strip ---
  # If the user set a value, keep it. If they didn't, don't invent one. The
  # platform UI is the right place to stop materializing a value the user
  # never chose; the sync layer faithfully propagates whatever was stored.

  # --- New prompts start modern ---

  @unit
  Scenario: The default prompt model is a current model the registry still serves
    When I read the platform default prompt model
    Then it resolves to a model present in the model registry
    And that model is not a legacy gpt-4 generation model

  @unit
  Scenario: Pushing a prompt with no temperature sends no temperature
    Given a local prompt YAML with no modelParameters temperature
    When the prompt is pushed to the platform
    Then the sync payload has no temperature
    # The full create-push-pull cycle is asserted by the @e2e scenario below,
    # which proves removing temperature from the YAML clears it end-to-end.

  @unit
  Scenario: Creating a prompt via the CLI does not inject a temperature
    When I run "langwatch prompt create my-prompt"
    Then the generated YAML has no modelParameters temperature
    And the generated model is not a legacy gpt-4 generation model

  # --- End-to-end: a new structured-output prompt survives the full cycle ---
  # The live-agent guarantee is additionally dogfooded by the prompts skill
  # scenario test (skills/_tests/prompts-cli.scenario.test.ts).

  @e2e
  Scenario: A new structured-output prompt survives a full create, push and pull cycle
    Given a prompt created from the CLI default template
    And a response_format declaring strict JSON output
    When the prompt is pushed to the platform and pulled back
    Then the pulled prompt is still on a current model
    And the pulled prompt has no temperature the model would reject
    And the pulled response_format equals the one that was pushed
