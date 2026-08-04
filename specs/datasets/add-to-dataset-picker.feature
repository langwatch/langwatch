Feature: Picking the target dataset when adding traces to a dataset
  As a user adding traces to a dataset
  I want the dataset picker to tell me what it is doing
  So that I never mistake a slow load for having no datasets at all

  # Context: the "Add to Dataset" drawer opens with a dataset dropdown that is
  # populated by a request. While that request is in flight the dropdown used to
  # render as an ordinary empty select, which reads exactly like "this project
  # has no datasets" - so users clicked it, saw nothing, and assumed the feature
  # was broken. A customer reported this on a project where the request took
  # several seconds. The dropdown must distinguish "still loading" from "empty".

  Background:
    Given I am logged in
    And I have access to a project

  # ============================================================================
  # Loading feedback
  # ============================================================================

  @integration
  Scenario: The dataset dropdown says it is loading
    Given my project's datasets have not finished loading
    When I open the "Add to Dataset" drawer
    Then the dataset dropdown tells me it is loading
    And it does not offer me an empty list to choose from

  @integration
  Scenario: A project with no datasets is told so, not left blank
    Given my project has no datasets
    When I open the "Add to Dataset" drawer
    Then the dataset dropdown tells me there are no datasets yet
    And I can create one from the drawer

  @integration
  Scenario: The datasets appear once they arrive
    Given my project has a dataset named "offline evals"
    When I open the "Add to Dataset" drawer
    And the datasets finish loading
    Then "offline evals" is offered in the dataset dropdown
    And the dropdown no longer says it is loading

  # ============================================================================
  # When the list cannot be fetched
  # ============================================================================

  @integration
  Scenario: A failed request is not reported as an empty project
    Given the request for my project's datasets fails
    When I open the "Add to Dataset" drawer
    Then the dataset dropdown tells me the datasets could not be loaded
    And it does not tell me I have no datasets

  @integration
  Scenario: I can still create a dataset from the drawer
    Given my project has no datasets
    When I open the "Add to Dataset" drawer
    And I choose to create a new dataset
    Then the dataset creation form opens
