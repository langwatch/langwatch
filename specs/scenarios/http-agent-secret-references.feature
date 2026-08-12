Feature: HTTP agent requests can reference project secrets
  As a user pointing a scenario at an external HTTP agent
  I want the credential that agent needs to come from the project's secrets
  So that an API key never has to be typed into the target's configuration,
  where anyone who can open the target can read it back.

  Background: where a secret may be referenced.
    A code target and a workflow target already read a project secret as
    "secrets.NAME". An http target gets the same reference, in the places a
    credential actually belongs: the url, the header values, and the auth
    fields. The body template is left alone, because it carries the
    conversation and is authored by whoever writes the scenario, not by
    whoever holds the credential. A reference to a name the project does not
    have is left exactly as written rather than turning into an empty string,
    so the failure reads as a missing secret instead of an unauthenticated
    request. Resolved values never appear in anything the run shows back.

  @unit
  Scenario: A secret reference in the url resolves to the project secret value
    Given a project secret "AGENT_TOKEN"
    And an http target whose url reads "secrets.AGENT_TOKEN"
    When the target takes a turn
    Then the request goes to the url with the secret's value in place of the reference

  @unit
  Scenario: Secret references resolve in header values and auth token, value, username, and password
    Given a project secret "AGENT_TOKEN"
    And an http target referencing it from a header value
    And an http target referencing it from the auth token, value, username, and password
    When each target takes a turn
    Then every one of those fields carries the secret's value

  @unit
  Scenario: A secret reference in the body template is left untouched
    Given a project secret "AGENT_TOKEN"
    And an http target whose body template reads "secrets.AGENT_TOKEN"
    When the target takes a turn
    Then the body it sends still reads "secrets.AGENT_TOKEN"

  @unit
  Scenario: A reference to a missing secret name stays verbatim in the request
    Given an http target referencing "secrets.NOT_A_SECRET"
    And the project has no secret by that name
    When the target takes a turn
    Then the request carries the reference exactly as written

  @unit
  Scenario: A resolved secret value is scrubbed from error messages
    Given a project secret "AGENT_TOKEN"
    And an http target referencing it that the upstream rejects
    When the run reports the failure
    Then the message names the failure without the secret's value anywhere in it

  @unit
  Scenario: Plaintext auth without secret references behaves unchanged
    Given an http target whose auth fields are typed in directly
    When the target takes a turn
    Then the request carries exactly what was typed in

  @unit
  Scenario: The http prefetch loads project secrets for the run
    Given a run whose targets include an http target
    When the run is prepared
    Then the project's secrets are available to that target for the whole run
