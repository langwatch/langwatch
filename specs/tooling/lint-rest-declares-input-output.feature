Feature: The rest-declares-input-output lint rule
  A standard JSON REST route declares `withInput` (when its method carries a
  body) and `withOutput` (or `responds()`), so the framework parses,
  validates and serialises on its behalf. The two genuinely non-JSON escapes,
  `publicRoute` and a `withRawResponse` answer, are exempt.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A GET route with withOutput and no body is compliant
    Given a GET route declaring withParams, withPermission and withOutput
    When the rest-declares-input-output rule runs over it
    Then it reports nothing

  @unit
  Scenario: A route with no declared answer is reported
    Given a GET route declaring withPermission and no answer
    When the rest-declares-input-output rule runs over it
    Then it reports missingOutput
    And the message names the route's own operation

  @unit
  Scenario: A POST route with both withInput and withOutput is compliant
    Given a POST route declaring withInput, withPermission and withOutput
    When the rest-declares-input-output rule runs over it
    Then it reports nothing

  @unit
  Scenario: A POST route missing withInput is reported
    Given a POST route declaring withPermission and withOutput but no withInput
    When the rest-declares-input-output rule runs over it
    Then it reports missingInput

  @unit
  Scenario: A POST route declaring withRawBody is not missing its input
    Given a POST route declaring withRawBody instead of withInput
    When the rest-declares-input-output rule runs over it
    Then it reports nothing

  @unit
  Scenario: A route missing both withInput and withOutput is reported twice
    Given a POST route declaring only withPermission
    When the rest-declares-input-output rule runs over it
    Then it reports missingOutput and missingInput

  @unit
  Scenario: A publicRoute escape is exempt from withInput and withOutput
    Given a route declaring withAccess(publicRoute(...)) and withRawResponse and no answer
    When the rest-declares-input-output rule runs over it
    Then it reports nothing

  @unit
  Scenario: A withRawResponse escape is exempt from withInput and withOutput
    Given a GET route declaring withRawResponse and no withOutput
    When the rest-declares-input-output rule runs over it
    Then it reports nothing

  @unit
  Scenario: responds() counts as a declared answer
    Given a GET route declaring responds() with two statuses
    When the rest-declares-input-output rule runs over it
    Then it reports nothing
