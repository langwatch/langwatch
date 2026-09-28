Feature: Experiment entry addresses forward where main sent them
  As a user following a link into experiments
  I want the new-experiment address and the retired wizard addresses to land where they always did
  So that bookmarks, dataset links and old wizard links keep working

  # Main's pages: experiments/workbench/index.tsx created and replaced,
  # evaluations/wizard.tsx chose the workbench, the workflow or the read-only view.

  @integration
  Scenario: Opening the new-experiment address creates one experiment and opens its workbench
    Given I open "/:project/experiments/workbench"
    When the experiment is created as "fresh-exp"
    Then the address is replaced with "/:project/experiments/workbench/fresh-exp"
    And only one experiment is created however often the page renders

  @integration
  Scenario: A dataset link seeds the new experiment with that dataset
    Given I open "/:project/experiments/workbench?datasetId=ds-1"
    When the dataset has loaded
    Then the experiment is created with that saved dataset as its active dataset

  @integration
  Scenario: A dataset link waits for its dataset before creating the experiment
    Given I open "/:project/experiments/workbench?datasetId=ds-1"
    When the dataset has not loaded yet
    Then no experiment is created

  @integration
  Scenario: A refused create shows why and stays on the new-experiment address
    Given I open "/:project/experiments/workbench"
    When creating the experiment is refused
    Then the refusal is shown under "Couldn't create the experiment"
    And the address is not replaced
    And the create is not retried

  @integration
  Scenario: A wizard link waits for its experiment before choosing where it opens
    Given a link to "/:project/evaluations/wizard/:slug"
    When the experiment has not been read yet
    Then the address is not replaced

  @integration
  Scenario: A wizard link to an experiment with no workbench and no workflow opens its read-only view
    Given a link to "/:project/evaluations/wizard/:slug" for an SDK experiment with no workflow
    When I open it
    Then I am redirected to "/:project/experiments/:slug"

  @integration
  Scenario: A wizard link whose experiment cannot be read opens the read-only view
    Given a link to "/:project/evaluations/wizard/:slug"
    When reading the experiment fails
    Then I am redirected to "/:project/experiments/:slug"
