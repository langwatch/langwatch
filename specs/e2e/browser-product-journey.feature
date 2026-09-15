Feature: Browser product journey

  A person who has never used LangWatch opens the application, signs up, and
  walks the product to a judged simulation run whose trace carries the result
  of an evaluator they wrote themselves.

  The journey runs against a stack the suite boots (dev/tests/e2e-stack), with
  a loopback echo agent as the target the run talks to, so every leg exercises
  the browser, the API process, the worker and the NLP engine together.

  Plan: dev/docs/plans/e2e-platform-plan-2026-09-04.md
  Suite: dev/tests/agentic-e2e/tests/journey/product-journey.spec.ts

  Background:
    Given a LangWatch stack with no account for me
    And a loopback echo agent that answers every request with a fixed reply

  @e2e
  Scenario: Signing up creates the account and signs me in
    Given I am on the sign-up page
    When I give my name, my email address and a password twice
    And I submit the form
    Then I am signed in and no longer on an authentication page

  @e2e
  Scenario: Onboarding names the organization and lands me on a project
    Given I have just signed up
    When I name my organization, agree to the terms and continue
    And I say I want to monitor and evaluate my LLM application
    And I finish onboarding and continue to LangWatch
    Then I am on a project of my own
    And the project address names the slug the platform chose

  @e2e
  Scenario: Adding an OpenAI model provider makes models available
    Given I am on the model providers settings page
    When I add OpenAI with my API key
    Then OpenAI is listed as a configured provider

  @e2e
  Scenario: Creating an HTTP agent pointed at the echo agent
    Given I am on the agents page
    When I create an HTTP agent whose address is the echo agent
    Then the agent is listed by name

  @e2e
  Scenario: Creating a custom code evaluator
    Given I am on the evaluators page
    When I create a Custom (Code) evaluator with a name, some Python and one input
    Then the evaluator is listed by name

  @e2e
  Scenario: Creating a monitor that runs the evaluator on every trace
    Given the project holds a code evaluator
    When I create a trace-level online evaluation that runs it with no preconditions
    Then the online evaluation is listed and active

  @e2e
  Scenario: Writing a scenario in a suite and starting the run
    Given the project has an agent and no test suite
    When I name a test suite
    And I write a scenario with a title, a situation and criteria
    And I choose Save and Run and pick the echo agent as the target
    Then the run drawer opens on the run

  @e2e
  Scenario: The run reaches a verdict and appears on the Results tab
    Given a run I have just started
    When I wait for the run drawer to settle
    Then the run shows a verdict rather than an empty drawer
    And the run plan is listed on the Results tab

  @e2e
  Scenario: The run's trace carries the evaluator's result
    Given a run that has reached a verdict
    When I open the traces list for the project
    Then a trace from the run is listed
    And its Evals section names the evaluator I created

  @e2e
  Scenario: Creating a workflow and a prompt from the product surfaces
    Given I am on a project of my own
    When I create a workflow from a template
    Then the workflow editor opens on it
    When I create a prompt and give it an identifier
    Then the prompt is saved and named

  @e2e
  Scenario: Sign-up refuses a password confirmation that does not match
    Given I am on the sign-up page
    When I type two different passwords and submit
    Then the form tells me the passwords do not match
    And no account is created

  @e2e
  Scenario: The run dialog refuses a run with no agent chosen
    Given I am in the run dialog with no target selected
    Then the run is refused with "Choose an agent to run against."

  @e2e
  Scenario: A run against an address that does not answer ends in a named failure
    Given an HTTP agent whose address refuses connections
    When I run a scenario against it
    Then the run ends in a failed verdict naming the reason
    And the drawer is not left blank
