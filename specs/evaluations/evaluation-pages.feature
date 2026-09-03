Feature: The evaluators and online evaluations pages
  As someone responsible for how an AI product is scored
  I want the evaluator library and the live evaluations running over production traffic
  So that I can see what scores my traffic, change it, and know what a change would take with it

  Background:
    Given evaluators are reusable scoring functions shared by experiments, online evaluations, and guardrails
    And an online evaluation scores live traces or threads after they arrive
    And a guardrail runs synchronously and can act on live traffic

  @unit @rbac
  Scenario: Reading the evaluator library needs the evaluations view grant
    Given I hold "evaluations:view"
    When I open the evaluators page
    Then the evaluator library opens

  @unit @rbac
  Scenario: A reader without the evaluations view grant reaches no evaluator page
    Given I do not hold "evaluations:view"
    When I open the evaluators page
    Then I am refused
    And the refusal names the grant I need

  @unit @rbac
  Scenario: Reading the online evaluations needs the evaluations view grant
    Given I hold "evaluations:view"
    When I open the online evaluations page
    Then the online evaluations page opens

  @unit @rbac
  Scenario: A reader without the evaluations view grant reaches no online evaluation page
    Given I do not hold "evaluations:view"
    When I open the online evaluations page
    Then I am refused
    And the refusal names the grant I need

  @unit
  Scenario: An empty evaluator library explains what an evaluator is for
    Given the project has no evaluators
    When I open the evaluators page
    Then I am told there are no evaluators yet
    And I am offered a way to create the first one

  @unit
  Scenario: Each evaluator is one card
    Given the project has two evaluators
    When I open the evaluators page
    Then each evaluator is represented by one card

  @unit
  Scenario: Creating an evaluator asks the application for the category picker
    Given I am on the evaluators page
    When I choose to create a new evaluator
    Then the application is asked to open the evaluator category picker

  @unit
  Scenario: Editing a code evaluator asks for the code editor and not the settings editor
    Given the project has a code evaluator and a built-in evaluator
    When I edit the code evaluator
    Then the application is asked to open the code evaluator editor
    When I edit the built-in evaluator
    Then the application is asked to open the evaluator editor
    And the request carries the evaluator's type

  @unit
  Scenario: A delete names what it would take with it before I confirm
    Given an evaluator has a linked workflow and two online evaluations
    When I choose to delete it
    Then I am told the workflow will be archived
    And I am told the online evaluations will be deleted

  @unit
  Scenario: A delete is not armed until I type the confirmation
    Given I am confirming the deletion of an evaluator
    Then the delete action is refused until I type "delete"

  @unit
  Scenario: An evaluator nothing depends on is deleted without the cascade
    Given an evaluator has no linked workflow and no online evaluations
    When I confirm its deletion
    Then only the evaluator is deleted

  @unit
  Scenario: An evaluator that other things depend on is deleted with the cascade
    Given an evaluator has a linked workflow
    When I confirm its deletion
    Then the workflow is archived with it
    And I am told what else was deleted

  @unit
  Scenario: The history I am reading is in the address
    Given I am on the evaluators page
    When I open one evaluator's history
    Then the address names that evaluator

  @unit
  Scenario: Replicating an evaluator offers every project, and refuses the closed ones
    Given I may create in one project and not in another
    When I open the replicate dialog
    Then both projects are listed
    And the project I may not create in cannot be chosen

  @unit
  Scenario: Each online evaluation is one row
    Given the project has two online evaluations
    When I open the online evaluations page
    Then each online evaluation is represented by one table row
    And a guardrail is labelled as a guardrail

  @unit
  Scenario: An unavailable performance trend says so rather than drawing a flat line
    Given the performance read failed
    When I open the online evaluations page
    Then the rows say the performance is unavailable

  @unit
  Scenario: The performance is asked for in the reader's own time zone
    Given my time zone is "Europe/Amsterdam"
    When I open the online evaluations page
    Then the performance is asked for in "Europe/Amsterdam"

  @unit
  Scenario: Both ways into a monitor's analytics reach the same filtered destination
    Given an online evaluation with recent results
    When I follow its performance preview
    And I choose "View analytics" from its row actions
    Then both lead to the analytics filtered to that online evaluation

  @unit
  Scenario: A reader without analytics access is told so rather than shown a dead link
    Given I do not hold "analytics:view"
    When I open the online evaluations page
    Then the performance column says analytics access is required

  @unit
  Scenario: Editing a monitor authored in the retired wizard opens the workbench
    Given an online evaluation was authored in the retired evaluation wizard
    When I edit it
    Then I am taken to that experiment's workbench

  @unit
  Scenario: Editing any other monitor asks the application for the online evaluation drawer
    Given an online evaluation was not authored in the retired wizard
    When I edit it
    Then the application is asked to open the online evaluation drawer
    And the request names that monitor

  @unit
  Scenario: Creating an online evaluation and setting up a guardrail are two different requests
    Given I hold "evaluations:manage"
    When I choose to create a new online evaluation
    Then the application is asked to open the online evaluation drawer
    When I choose to set up a guardrail
    Then the application is asked to open the guardrails drawer

  @unit
  Scenario: A reader who may not manage evaluations is offered neither create action
    Given I do not hold "evaluations:manage"
    When I open the online evaluations page
    Then I am offered no way to create an online evaluation or a guardrail

  @unit
  Scenario: Deleting an online evaluation asks first and reports afterwards
    Given the project has an online evaluation
    When I choose to delete it
    Then I am asked to confirm
    When I confirm
    Then I am told it was deleted

  @unit
  Scenario: The retired evaluation wizard address forwards to the experiments workbench
    Given I open the retired evaluation wizard address with no experiment named
    Then I am forwarded to the experiments workbench

  @unit
  Scenario: A replication target I cannot create in is listed rather than hidden
    Given I belong to a team that may not create evaluations in one of its projects
    When I ask which projects I could replicate into
    Then that project is listed as closed to me

  @unit
  Scenario: A team I am not a member of contributes no replication targets
    Given a team I hold no membership in
    When I ask which projects I could replicate into
    Then none of that team's projects are listed

  @unit
  Scenario: The API snippets name this installation's own endpoint
    Given I am running LangWatch somewhere other than the hosted service
    When I read the snippets that call an evaluator from my own code
    Then they set the endpoint to this installation's address
