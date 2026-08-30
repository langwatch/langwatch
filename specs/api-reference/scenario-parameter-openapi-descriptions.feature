@unit
Feature: Scenario-parameter descriptions reach the OpenAPI document
  As an integrator reading the scenarios API reference
  I want shared scenario-parameter schemas to keep their field descriptions
  So that regenerating the OpenAPI document does not silently erase what
  `defaultValue` and `secret` mean.

  Background:
    Given the shared scenario-parameter schema module is imported in-process

  Scenario: Loading zod-openapi before the schema keeps the descriptions
    Given the zod-openapi patch module loads before the schema is constructed
    When the schema is converted to the OpenAPI input document
    Then the `defaultValue` field keeps its description
    And the `secret` field keeps its description

  Scenario: Another module may import the schema before the patch and the descriptions still survive
    Given another module loads the shared schema before zod-openapi
    When the schema is later converted to the OpenAPI input document
    Then the `defaultValue` field keeps its description
    And the `secret` field keeps its description
