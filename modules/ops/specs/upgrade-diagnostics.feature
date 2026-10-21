# One redacted bundle per failed step, for the LangWatch team to debug it.
# Plan: dev/docs/plans/upgrade-diagnostics-via-connect.md.
Feature: Upgrade step diagnostics

  @unit
  Scenario: A step's diagnostics bundle names the step, its error, targets, log and deployment
    Given a failed background step with a target error and a log tail
    When an operator asks for its diagnostics
    Then the bundle carries the step's id, mode, release, status, attempt and error
    And the step's report, each target's error and the log tail
    And the image release, chart version, install method and instance id

  @unit
  Scenario: A diagnostics bundle drops the values a validation error quotes
    Given a failed step whose report holds a validation issue with its received input
    When an operator asks for its diagnostics
    Then the bundle keeps the issue's path and message but not the received input

  @unit
  Scenario: A diagnostics bundle redacts secrets and cuts long strings
    Given a failed step whose report holds a URL with a password and a 10 KB string
    When an operator asks for its diagnostics
    Then the bundle masks the password and cuts the string to 4 KB

  @unit
  Scenario: A diagnostics bundle drops secret-named fields and masks credentials in text
    Given a failed step whose report holds a password, an authorization header and an apiKey
    And whose error and log carry an apiKey in JSON and a bearer token in a header
    When an operator asks for its diagnostics
    Then the bundle drops those report fields, names each one it dropped, and masks the credentials in the text

  @unit
  Scenario: A diagnostics bundle stays under its size cap
    Given a failed step whose report and log would exceed 64 KB
    When an operator asks for its diagnostics
    Then the bundle is at most 64 KB and says what it left out

  @unit
  Scenario: Diagnostics for an unknown step are refused by name
    Given no step with the id asked for
    When an operator asks for its diagnostics
    Then the request is refused with the code "upgrade_not_found"

  @integration
  Scenario: The step drawer offers to copy and download the step's diagnostics
    Given a failed step open in the Upgrades drawer
    When the operator chooses Download diagnostics
    Then a JSON file named after the step is saved
    And Copy diagnostics copies the same bundle

  @integration
  Scenario: The step drawer shows the step's recent log lines
    Given a step with a log tail open in the Upgrades drawer
    Then the drawer shows its recent log lines

  @integration
  Scenario: Send to LangWatch shows the exact bundle before it is sent
    Given an ops admin has a failed step open and the install can reach LangWatch
    When they choose Send to LangWatch
    Then the bundle is shown first
    And it is sent only once they confirm

  @unit
  Scenario: Send to LangWatch sends the bundle the operator reviewed
    Given an operator reviewed a failed step's bundle
    When they confirm the send
    Then LangWatch receives that bundle unchanged, redacted and capped again on the way out

  @integration
  Scenario: Send to LangWatch is not offered where the install cannot reach LangWatch
    Given an ops admin has a failed step open on an install without Connect
    Then the drawer offers Copy and Download diagnostics but not Send to LangWatch

  @unit
  Scenario: The install sends diagnostics by itself unless an operator switched it off
    Given the install can reach LangWatch
    When the environment or the Checkup switch turns automatic sending off
    Then diagnostics are still available to send by hand but are not sent by themselves
