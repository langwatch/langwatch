Feature: Topic naming uses a temperature the model accepts
  As an operator who picks a reasoning model for topic clustering
  I want the naming call to use a temperature that model accepts
  So that my run returns named topics instead of silently dropping them

  @unit
  Scenario: A reasoning naming model is called at temperature one
    Given a batch clustering request names topics with "openai/gpt-5-mini"
    When langevals calls the naming model
    Then the request uses temperature 1.0
    And the run returns one name for each topic

  @unit
  Scenario: Other naming models stay at temperature zero
    Given a batch clustering request names topics with "openai/gpt-4o-mini"
    When langevals calls the naming model
    Then the request uses temperature 0.0
    And the run returns one name for each topic

  @unit
  Scenario: Disambiguation uses the same temperature rule
    Given two topics need distinct names with "openai/gpt-5-mini"
    When langevals asks the model to disambiguate them
    Then the request uses temperature 1.0
    And the run returns the two new names

  @unit
  Scenario: Another reasoning model refusing temperature is retried once
    Given a batch clustering request names topics with "openai/o3"
    And the model rejects temperature 0.0 before the request is sent
    When langevals calls the naming model
    Then the request is retried once without temperature
    And the run returns one name for each topic
