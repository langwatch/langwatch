Feature: The evaluator catalogue publishes each evaluator's settings schema

  `GET /api/evaluations/list` is what a caller renders an evaluator's settings
  form from. Each entry carries `settings_json_schema`, the JSON Schema of that
  evaluator's settings object. A schema with no `properties` describes nothing,
  so the form has nothing to draw and the caller cannot tell an evaluator that
  takes no settings from one whose settings were dropped.

  @unit
  Scenario: An evaluator's settings are described field by field
    Given an evaluator whose settings carry a default and a description
    When the catalogue is built
    Then its settings schema names the object's type and each setting
    And each setting keeps its default and its description

  @unit
  Scenario: A setting with a fixed list of choices publishes that list
    Given an evaluator setting that accepts one of a fixed set of values
    When the catalogue is built
    Then its settings schema lists those values as an enumeration

  @unit
  Scenario: An evaluator that takes no settings still answers a schema
    Given an evaluator with no settings
    When the catalogue is built
    Then its settings schema describes an object with no settings

  @unit
  Scenario: The catalogue leaves the documentation examples out
    When the catalogue is built
    Then no example evaluator is listed
