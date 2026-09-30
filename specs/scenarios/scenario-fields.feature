Feature: Scenario fields
  As a person who writes agent scenarios that carry a golden answer or a schema
  I want the test suite to declare typed fields and every scenario to carry a value per field
  So that evaluators can read those values and the suite reads like a dataset

  Background: what a field is.
    A test suite declares fields beyond situation and criteria: an identifier
    such as expected_tools or golden_sql, and a type of text, number or
    boolean. Every scenario filed in the suite carries one value per field. A
    blank value means the scenario has no value for that field.

    An evaluator attached to the suite reads a field through a mapping. When
    the field is blank on a scenario, that evaluator is skipped for the run
    with a reason. See specs/suites/test-suites.feature for attachments.

  # --- Declaring fields ---

  @unit
  Scenario: A field identifier is lowercase letters, digits and underscores
    When a suite declares the field "golden_sql" of type text
    Then the declaration is accepted
    When a suite declares the field "Golden SQL"
    Then the declaration is refused with "suite_field_identifier_invalid"

  @unit
  Scenario: A field cannot take a name the scenario already answers to
    When a suite declares a field named "situation"
    Then the declaration is refused with "suite_field_identifier_invalid"

  @unit
  Scenario: Two fields cannot share an identifier
    When a suite declares "golden_sql" twice
    Then the declaration is refused with "suite_field_identifier_duplicate"

  # --- Values on a scenario ---

  @unit
  Scenario: A typed value is read in the field's own type
    Given a number field "max_rows"
    When a scenario carries the text "12" for it
    Then the value reads as the number 12
    Given a boolean field "needs_approval"
    When a scenario carries the text "yes" for it
    Then the value reads as true
    When a scenario carries an empty string for a field
    Then the value reads as no value

  @unit
  Scenario: A value that cannot be read as the field's type is no value
    Given a number field "max_rows"
    When a scenario carries the text "twelve" for it
    Then the value reads as no value

  @integration
  Scenario: A scenario carries a value per suite field
    Given a test suite declaring the text field "golden_sql"
    When a scenario in it is saved with golden_sql "SELECT 1"
    Then the scenario reads back with golden_sql "SELECT 1"

  @integration
  Scenario: A value for a field the suite does not declare is refused
    Given a test suite declaring the text field "golden_sql"
    When a scenario in it is saved with a value for "table_schema"
    Then the save is refused with "scenario_field_unknown"

  @integration
  Scenario: A value of the wrong type is refused
    Given a test suite declaring the number field "max_rows"
    When a scenario in it is saved with max_rows "twelve"
    Then the save is refused with "scenario_field_type_invalid"

  @integration
  Scenario: A blank value clears the field on the scenario
    Given a scenario carrying golden_sql "SELECT 1"
    When it is saved with an empty golden_sql
    Then the scenario reads back with no value for golden_sql

  # --- Field values over the public API ---

  @integration
  Scenario: The scenario API accepts and returns field values
    Given a test suite declaring the text field "golden_sql"
    When a scenario is created over the API with fields { golden_sql: "SELECT 1" }
    Then the response carries fields { golden_sql: "SELECT 1" }
    And reading the scenario back returns the same fields
