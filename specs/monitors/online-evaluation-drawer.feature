@integration
Feature: Online Evaluation Drawer
  As a user
  I want to create and configure online evaluations in a drawer
  So that I can monitor traces and threads with evaluators

  Background:
    Given I am logged in to a project
    And I have at least one evaluator created

  @unimplemented
  Scenario: Select trace level evaluation
    Given the online evaluation drawer is open
    When I select "Trace" level
    Then trace-level mapping sources should be available
    And sources should include input, output, contexts, metadata, spans

  @unimplemented
  Scenario: Select thread level evaluation
    Given the online evaluation drawer is open
    When I select "Thread" level
    Then thread-level mapping sources should be available
    And sources should include thread_id and traces array

  @unimplemented
  Scenario: Configure sampling
    Given the online evaluation drawer is open with evaluator selected
    When I set sampling to 50%
    Then the sample value should be 0.5
    And the slider should show 50%

