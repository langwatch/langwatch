Feature: Suite templates
  A suite template is a ready set of scenarios shipped in code. Applying one,
  fitted to the agent under test, creates a test suite and files every
  scenario of the template in it. The first pack is the OWASP Top 10 for LLM
  Applications 2025 as red team attacks.

  Background:
    Given a project the caller may manage scenarios in

  @unit
  Scenario: Every shipped template parses with the template schema
    When the shipped templates are read
    Then each one parses with suiteTemplateSchema
    And the OWASP LLM Top 10 2025 pack holds one attack per id LLM01 to LLM10 under its official name

  @unit
  Scenario: Listing templates answers every template sorted with full preview data
    When the caller lists templates
    Then every shipped template is returned sorted by kind then title
    And each carries its scenarios, attack goals and OWASP ids

  @unit
  Scenario: Applying a template creates a test suite with its scenarios
    When the caller applies "owasp-llm-top-10-2025" fitted to agent "ACME Support"
    Then a test suite named after the template is created
    And ten red team scenarios are filed in it, one per attack
    And the answer names the suite id, slug, name and scenario ids

  @unit
  Scenario: Applying fills the fit placeholders into every scenario's text
    When the caller applies a template with agent name "ACME Support", tools "refund" and "lookup_order", and must never "issue a refund above 100 EUR"
    Then no created scenario's name, situation, criteria or attack goal contains "{{agentName}}", "{{tools}}" or "{{mustNever}}"
    And the text names "ACME Support", "refund, lookup_order" and "issue a refund above 100 EUR"

  @unit
  Scenario: Each scenario carries its own criteria followed by the template's
    When the caller applies a template that declares template-wide criteria
    Then each created scenario's criteria are its own followed by the template's, without duplicates

  @unit
  Scenario: The suite records the template id and version it came from
    When the caller applies "owasp-llm-top-10-2025" version 1
    Then the created test suite records template id "owasp-llm-top-10-2025" and template version 1

  @unit
  Scenario: A plan creation cap that cannot take every scenario refuses before anything is written
    Given the organization's plan caps scenarios and has fewer free slots than the template's scenarios
    When the caller applies the template
    Then the apply is refused with the existing limit exceeded error for scenarios
    And no test suite and no scenario is created

  @unimplemented
  Scenario: A caller without scenario manage permission cannot apply a template
    Given a caller who may only view scenarios
    When the caller applies a template
    Then the request is refused by the route permission before the handler runs

  @unit
  Scenario: Applying an unknown template is refused as not found
    When the caller applies template "no-such-template"
    Then the apply is refused with code "suite_template_not_found"
    And nothing is created

  @unit
  Scenario: A fit without an agent name is refused as a validation error
    When the caller applies a template with an empty agent name
    Then the request is refused as a validation error naming the agent name field
    And nothing is created

  @unit
  Scenario: A red team scenario is created with its attack config
    When a scenario of kind "red_team" is created with an attack goal and OWASP ids
    Then it is stored with that kind and the parsed config

  @unit
  Scenario: A red team scenario without a config is refused
    When a scenario of kind "red_team" is created without a red team config
    Then it is refused with code "scenario_red_team_config_mismatch" and nothing is written

  @unit
  Scenario: A standard scenario with a red team config is refused
    When a standard scenario is created with a red team config
    Then it is refused with code "scenario_red_team_config_mismatch" and nothing is written

  @unit
  Scenario: Listing templates over REST answers every shipped template
    When the caller sends GET /api/v1/test-suites/templates with scenarios view permission
    Then the response is 200 with every shipped template and its scenarios

  @unit
  Scenario: Applying a template over REST creates a test suite
    When the caller sends POST /api/v1/test-suites/templates/owasp-agentic-top-10/apply with a fit
    Then the response is 201 with the suite id, slug, name and scenario ids

  @unit
  Scenario: Applying an unknown template over REST answers 404
    When the caller sends POST /api/v1/test-suites/templates/no-such-template/apply
    Then the response is 404 with code "suite_template_not_found"
