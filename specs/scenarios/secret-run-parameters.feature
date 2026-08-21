Feature: Secret run parameters
  As someone who starts a scenario run against a real system
  I want to supply a credential the run needs without storing it anywhere
  So that the target under test can authenticate as a real caller, and the
  value is gone from every record the run leaves behind.

  Background: how a secret parameter differs from a plain one.
    A scenario declares a parameter as secret. A secret parameter carries no
    default value: the value is supplied when the run starts and only then.
    The run encrypts it before anything is written down, and delivers it to the
    target under test through the same "secrets" namespace project secrets use:
    "{{ secrets.NAME }}" in an http template, "secrets.NAME" in a code target.
    The scenario's own situation and criteria cannot read it. The names are
    recorded so a person can see which credentials a run needed; the values are
    not recorded anywhere.

  # --- Declaring ---

  @unit
  Scenario: A parameter declared secret cannot carry a default value
    Given a scenario declaring "api_token" as secret with the default "abc"
    When the scenario is saved
    Then the save is rejected before the scenario is stored

  # --- Starting a run ---

  @unit
  Scenario: A secret parameter value must be supplied when the run starts
    Given a scenario declaring "api_token" as secret
    When the run is started with no value for "api_token"
    Then the run is rejected before any job is scheduled
    And the rejection names "api_token"

  @unit
  Scenario: A name declared secret in one scenario and plain in another rejects the run
    Given one scenario declaring "api_token" as secret
    And another scenario in the same run declaring "api_token" as plain
    When the run is started
    Then the run is rejected before any job is scheduled
    And the rejection names "api_token"

  @unit
  Scenario: Scenario text cannot read a secret parameter
    Given a scenario declaring "api_token" as secret
    And its situation reads "params.api_token"
    When the run is started with a value for "api_token"
    Then the run is rejected before any job is scheduled
    And the rejection says a secret parameter cannot be read from scenario text

  # --- Reaching the target under test ---

  @unit
  Scenario: A secret value reaches targets through the secrets namespace
    Given an http target whose header reads "secrets.api_token"
    And the run supplies "api_token" as "tok-live-1"
    When the target takes a turn
    Then the request it sends carries "tok-live-1" in that header

  @unit
  Scenario: A run value overrides a project secret with the same name for that run
    Given a project secret "API_TOKEN" holding "project-value"
    And a run supplying the secret parameter "API_TOKEN" as "run-value"
    When the target takes a turn
    Then the target reads "run-value" for "secrets.API_TOKEN"

  # --- Never written down ---

  @integration
  Scenario: A secret value is never written to the simulation runs store
    Given a run started with the secret parameter "api_token" as "tok-live-1"
    When the run is queued and recorded
    Then the stored run names "api_token" as a secret it used
    And neither the value nor its encrypted form is in the stored run

  @integration
  Scenario: The runs API never returns a secret value
    Given a recorded run that used a secret parameter
    When the run is read back over the API
    Then the response carries no secret value and no encrypted form of one

  @unit
  Scenario: The CSV export omits secret values
    Given a run that used a secret parameter
    When its runs are exported to CSV
    Then the parameters column holds only the plain parameter values

  @unit
  Scenario: Error messages never contain a secret value
    Given a run rejected because a secret parameter has no value
    When the rejection is presented to whoever started the run
    Then the message names the parameter and carries no value

  @unit
  Scenario: Audit log entries never record a secret value
    Given a run started with parameter values
    When the audit trail records the action
    Then the entry keeps the parameter names and replaces every value

  # --- In the platform ---

  @integration
  Scenario: The definitions editor disables the default value for a secret parameter
    Given the parameters editor of a scenario, with a row holding a default
    When the row is marked secret
    Then the default value is cleared and the field takes no more input
    And the saved scenario declares the parameter as secret with no default

  @integration
  Scenario: The run dialog requires a value for every secret parameter
    Given a run plan whose scenarios declare a secret parameter
    When the run confirmation opens
    Then the field for that parameter hides what is typed and starts empty
    And the run cannot start until the field holds a value

  @integration
  Scenario: The run detail drawer masks secret parameter names
    Given a recorded run that used a secret parameter
    When its detail drawer opens
    Then the parameters section names the parameter after the plain ones
    And it shows a mask in place of a value
