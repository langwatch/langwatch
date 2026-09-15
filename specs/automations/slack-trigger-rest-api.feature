Feature: The Slack alert trigger door refuses a bad body the way it always has

  `POST /api/trigger/slack` is the narrow ancestor of `/api/triggers`, kept for
  callers written against it. It publishes three answers and no others: a 400
  for a body it cannot read, a 400 naming the fields it refused, and one 500
  sentence for a failure the caller has no action for.

  A refused body must not reach the 500. "Error creating trigger" tells the
  caller the server broke and invites a retry of a body that will never be
  accepted, and it hides which field was wrong.

  The route also answers at its bare path, its `/api/v1` alias and each dated
  version namespace. Those are spellings of one route, so they authenticate
  alike; an alias that let a caller in where the canonical path refuses would
  be a way around the credential.

  @integration
  Scenario: A body missing its required fields is refused by name
    Given a caller holding the trigger permission
    When it creates a Slack trigger with an empty body
    Then the request is refused with status 400
    And the answer names the fields that were refused
    And no trigger is created

  @integration
  Scenario: A body that is not JSON is refused
    Given a caller holding the trigger permission
    When it creates a Slack trigger with a body that is not JSON
    Then the request is refused with status 400
    And no trigger is created

  @integration
  Scenario: A valid body creates the trigger
    Given a caller holding the trigger permission
    When it creates a Slack trigger with a webhook, a name and an alert type
    Then the trigger is created with the Slack action

  @integration
  Scenario: Every spelling of the route demands the same credential
    Given a caller the credential chain does not authenticate
    When it creates a Slack trigger at the bare path, the versioned alias and each dated namespace
    Then every one of them is refused
