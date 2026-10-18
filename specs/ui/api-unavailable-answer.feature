Feature: A call that lands on an API process starting or shutting down is sent again

  During a deploy an api process that is starting or draining answers every
  request with a plain-text 503 ("langwatch-api is shutting down") before any
  handler runs. The browser's tRPC client read that text as JSON and surfaced
  "Unexpected token 'l', "langwatch-"... is not valid JSON" on whatever page
  was open. Nothing ran on the server, so the call is safe to send again, and
  the next attempt reaches a process that is up.

  @unit
  Scenario: A call refused by a process that is shutting down is sent again
    Given the API answers a call with a plain-text 503 once
    When the browser sends the call
    Then it sends the call a second time
    And the page receives the answer of the second attempt

  @unit
  Scenario: The wait between attempts follows the API's Retry-After
    Given the API answers a plain-text 503 with "Retry-After: 2"
    When the browser sends the call
    Then it waits 2 seconds before the next attempt

  @unit
  Scenario: A process that stays unavailable reads as a 503 error, not broken JSON
    Given the API keeps answering a plain-text 503
    When the browser has sent the call as many times as it allows
    Then the page receives a tRPC error carrying HTTP status 503 and the API's sentence

  @unit
  Scenario: A JSON 503 from a handler is passed through untouched
    Given a handler answers a call with a JSON 503
    When the browser sends the call
    Then it sends the call once and the page receives that answer
