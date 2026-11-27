Feature: The ingestion-template REST routes validate their bodies at the door
  `/api/governance/ingestion-templates` declares its body schemas in the
  governance contract. A required field the wire names is required there,
  so an empty value is refused by the door, as a `validation_error` naming
  the wire field, before the application runs. The domain keeps its own
  checks (a source type's spelling, an unknown template) behind it.

  Pairs with:
    - specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature

  Background:
    Given a member who may manage AI tools, holding a project key bound to them

  @unit
  Scenario: An empty source type is refused at the door
    When they create an ingestion template with an empty `source_type`
    Then the response is 422 with code `validation_error`, naming `source_type`
    And no template is written

  @unit
  Scenario: An empty source template id is refused at the door
    When they clone an ingestion template with an empty `source_template_id`
    Then the response is 422 with code `validation_error`, naming `source_template_id`
    And no template is written
