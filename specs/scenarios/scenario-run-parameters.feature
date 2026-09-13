Feature: Scenario run parameters
  As a subject-matter expert who owns a scenario
  I want to name the values a run depends on and give each one a default
  So that the same scenario can be re-run against another account, tenant or
  region without rewriting it, and whoever starts the run can see and change
  those values in one place.

  Background: how a value is resolved.
    A scenario declares its parameters by name. Each declaration carries an
    optional description and an optional default value. Whoever starts a run
    may supply a value for any declared name. A supplied value wins over the
    declared default, and a name with neither a supplied value nor a default is
    missing. The resolved values are handed to the target under test, and the
    scenario's own situation and criteria can read them as "params.NAME".

  # --- Declaring and resolving ---

  @integration
  Scenario: Parameter definitions are persisted on a scenario
    Given a scenario declaring "account_tier" with the description "Which plan the customer is on" and the default "gold"
    When the scenario is saved and read back
    Then the declaration is still there with its description and its default

  @integration
  Scenario: The parameters editor opens ready to declare the first parameter
    Given a scenario that declares no parameters
    When its parameters editor opens
    Then an empty row is ready with its name, description and default value fields
    And the name field hints an example name
    And closing the editor without typing leaves the scenario declaring none

  @unit
  Scenario: A run-time value overrides the scenario's default value
    Given a scenario declaring "account_tier" with the default "gold"
    When the run supplies "account_tier" as "platinum"
    Then the run resolves "account_tier" to "platinum"

  @unit
  Scenario: A parameter with no run-time value falls back to its default
    Given a scenario declaring "region" with the default "eu-central"
    When the run supplies no value for "region"
    Then the run resolves "region" to "eu-central"

  @integration
  Scenario: A run-time key no scenario in the run declares is rejected with scenario_parameter_unknown
    Given a run covering scenarios that between them declare only "region" and "account_tier"
    When the run is started with a value for "regoin"
    Then the run is rejected with "scenario_parameter_unknown"
    And the rejection names "regoin" and the names the run does declare

  # --- Limits at save time and at run time ---

  @unit
  Scenario: A parameter name outside the identifier grammar is rejected at save time
    Given a scenario declaring a parameter named "account tier"
    When the scenario is saved
    Then the save is rejected before the scenario is stored

  @unit
  Scenario: More than twenty definitions on one scenario are rejected at save time
    Given a scenario declaring twenty-one parameters
    When the scenario is saved
    Then the save is rejected before the scenario is stored

  @unit
  Scenario: A run-time payload over the size limits is rejected before scheduling
    Given a run supplying values for more than fifty names
    When the run is requested
    Then the request is rejected before any job is scheduled
    And a payload whose values together exceed sixteen kilobytes is rejected the same way

  # --- Rendering the scenario's own text ---

  @integration
  Scenario: Situation and criteria render params references before the simulated user and judge see them
    Given a scenario whose situation and criteria read "params.account_tier"
    And the run resolves "account_tier" to "platinum"
    When the scenario runs
    Then the simulated user is briefed with "platinum" in place of the reference
    And the judge scores against criteria that read "platinum" too

  @unit
  Scenario: A scenario without parameters renders byte-identical to its stored text
    Given a scenario that declares no parameters and a run that supplies none
    And its situation contains the characters "{{" and "{%"
    When the run prepares the situation and criteria
    Then the text handed on is byte-identical to what was stored

  @unit
  Scenario: A params reference with no resolved value fails the run request with scenario_parameter_missing
    Given a scenario whose situation reads "params.account_tier"
    And neither a supplied value nor a default for "account_tier"
    When the run prepares the situation
    Then preparation fails with "scenario_parameter_missing"
    And the failure names "account_tier" and the field it was read from

  @unit
  Scenario: A hostile template is stopped by the render limits
    Given a scenario whose situation is written to loop without end
    When the run prepares the situation
    Then preparation fails with "scenario_parameter_template_invalid"
    And the failure names the field that could not be rendered

  # --- Reaching the target under test ---

  @unit
  Scenario: An http target reads params in its url and body templates
    Given an http target whose url and body template read "params.account_tier"
    And the run resolves "account_tier" to "platinum"
    When the target takes a turn
    Then the request it sends carries "platinum" in both the url and the body

  @integration
  Scenario: A code target reads params.NAME the same way it reads secrets.NAME
    Given a code target reading "params.region"
    And the run resolves "region" to "eu-central"
    When the target takes a turn
    Then the code reads "eu-central" from "params.region"

  @unit
  Scenario: A workflow target receives params as entry inputs
    Given a workflow target and a run resolving "region" to "eu-central"
    When the target takes a turn
    Then the workflow entry receives "region" as an input holding "eu-central"

  @unit
  Scenario: A prompt target reads params in its prompt template
    Given a prompt target whose template reads "params.account_tier"
    And the run resolves "account_tier" to "platinum"
    When the target takes a turn
    Then the prompt sent to the model reads "platinum"

  # --- Starting a run and reading it back ---

  @integration
  Scenario: Resolved parameter values are recorded on the run and shown in the run detail drawer
    Given a run started with "account_tier" as "platinum"
    When the run finishes and someone opens its detail drawer
    Then the drawer shows "account_tier" holding "platinum"

  @integration
  Scenario: Suite run confirmation prefills parameter values from scenario defaults
    Given a run plan whose scenarios declare "region" with the default "eu-central"
    When the run confirmation opens
    Then "region" is offered already filled in with "eu-central"
    And changing it there changes the value the run uses

  @integration
  Scenario: The suite run REST endpoint schedules jobs and returns the batch id
    Given a run plan and a set of parameter values
    When the run is requested over the API
    Then the response carries the batch id for the scheduled run

  @unit
  Scenario: The experiment run command passes param flags the same way suite run does
    Given an experiment started from the command line with a param flag
    When the command runs
    Then the run it starts resolves that name to the flag's value

  @unit
  Scenario: The workflow run command merges param flags into its entry inputs
    Given a workflow started from the command line with a param flag
    When the command runs
    Then the workflow entry receives that name as an input holding the flag's value

  # --- Parameters per target ---
  #
  # A run may point one agent at itself on two models. A target can therefore
  # carry parameter overrides of its own, merged over the values supplied for
  # the run as a whole. The target's values win. Each target's merged set is
  # checked the way the run's values are: a name no scenario in the run
  # declares is refused. Secret values are supplied once per run and never per
  # target, so a target that tries to carry one is refused before anything is
  # scheduled or written.

  @unit
  Scenario: Each target receives its own parameters merged over the run parameters
    Given a scenario declaring "model" with the default "gpt-5" and "region" with the default "eu-central"
    And a run supplying "region" as "us-east"
    And a target carrying the override "model=gpt-5-mini" beside a target carrying none
    When the run is prepared
    Then the target with the override resolves "model" as "gpt-5-mini" and "region" as "us-east"
    And the target without one resolves "model" as "gpt-5" and "region" as "us-east"

  @unit
  Scenario: A target override no scenario in the run declares is refused
    Given a scenario declaring only "model"
    When a run is started with a target carrying the override "seats=12"
    Then the run is refused with the code "scenario_parameter_unknown"
    And nothing is scheduled

  @unit
  Scenario: The refusal names the target it was resolved for
    Given a run against two connected agents that declare different parameters
    When one of them is given a value only the other one declares
    Then the refusal carries the name and the environment of that target
    And the customer reads that this target does not declare the name

  @unit
  Scenario: A target override naming a secret parameter is refused
    Given a scenario declaring the secret parameter "api_token"
    When a run is started with a target carrying the override "api_token=..."
    Then the run is refused with a validation error naming the targets field
    And nothing is scheduled

  @unit
  Scenario: The target key and its parameters travel in the run metadata
    Given a run against "prod-agent" and against "prod-agent" with the override "model=gpt-5-mini"
    When the runs of the batch are queued
    Then every run carries "targetKey" in the reserved langwatch namespace
    And the run of the variant carries "targetParameters" holding only the override
    And the run of the plain target carries no "targetParameters" key
    And the "parameters" of each run hold that target's merged values

  @integration
  Scenario: The target key and its parameters read back off the stored run
    Given a run queued against "prod-agent" with the override "model=gpt-5-mini"
    When the run is stored and read back
    Then its metadata carries the target key and the override under the reserved langwatch namespace
