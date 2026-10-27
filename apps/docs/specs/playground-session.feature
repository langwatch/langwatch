Feature: Use my LangWatch account in the API playground
  A signed-in reader sends real requests from the docs with a five-minute key minted
  for one project, never their session. See ADR-185.

  @integration
  Scenario: Connect with my account
    Given the docs were built with an app origin
    When I press Use my LangWatch account in the playground
    Then the app's consent page opens in a popup with a fresh single-use state
    When the popup posts a granted result for that state
    Then the playground shows the project and when access ends
    And requests are sent to the app's API with the key as X-Auth-Token and no cookies

  @integration
  Scenario: Ignore any message that is not the expected answer
    Given a connection is waiting for the popup
    When a message arrives from another origin, another window, with a used or unknown state, or with a malformed body
    Then it is ignored and the playground stays waiting
    And a valid answer after that still connects

  @integration
  Scenario: Keep the key out of every place it could leak
    Given the playground is connected
    Then the key is in no URL, storage, generated example or copied snippet

  @integration
  Scenario: Fall back to a pasted key when connecting does not work
    When the popup is blocked, closed before answering, denied, or silent for two minutes
    Then the playground says which happened
    And the pasted API key field still works

  @integration
  Scenario: End the connection when access ends
    Given the playground is connected
    When the key expires, a request answers 401, I disconnect, or I leave the page
    Then the key is cleared and pending requests are cancelled
    And connecting again asks the app for consent again

  @integration
  Scenario: Say so when my access does not allow a request
    Given the playground is connected
    When a request answers 403
    Then the playground says my access in this project does not allow it
    And it does not retry or switch to another key

  @integration
  Scenario: Disconnect revokes the key on the app
    Given the playground is connected
    When I disconnect
    Then the key is cleared at once and the app is asked to revoke it
    And if that fails the playground says the disconnection was local and the key expires within five minutes

  @unit
  Scenario: Offer only the pasted key when the build names no app
    Given the docs were built without an app origin
    Then the playground offers only the pasted API key

  @e2e
  Scenario: Connect and send through haven, where the docs share the app's address
    Given haven serves the docs at the app's /docs
    And I am signed in to the app
    When I connect the playground, choose a project and send a request
    Then the response comes from my project
    And signing out of the app makes the next request answer 401

  @unit
  Scenario: Offer the connection only where a project key answers
    Given an endpoint that takes an admin or other bearer token, not X-Auth-Token
    Then the playground offers no connection there and sends the pasted key
    And an endpoint that takes X-Auth-Token offers the connection
