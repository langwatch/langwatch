Feature: Use my LangWatch account in the API playground
  A signed-in reader sends real requests from the docs as themselves in one project, for at
  most five minutes. The key stays in a frame on the app's origin and never enters the docs
  page, which carries analytics. See ADR-185 and its amendment of 2026-10-28.

  @integration
  Scenario: Embed the app's session frame where a project key answers
    Given the docs were built with an app origin
    When I open the playground on an endpoint that takes X-Auth-Token
    Then the app's session frame is embedded for this docs origin
    And the docs page never receives or holds a key

  @integration
  Scenario: Send through the frame while it is connected
    Given the frame says it is connected in a project
    Then the pasted key field is hidden
    When I send a request
    Then the docs page asks the frame to send it, without any key in it
    And shows the response the frame answers with

  @integration
  Scenario: Listen only to the frame it embedded
    Given the frame is embedded
    When a message arrives from another origin or another window
    Then the playground ignores it

  @integration
  Scenario: Fall back to the pasted key when the frame is not connected
    Given the frame says it is not connected, or never answers
    Then the pasted API key field is shown
    And a request is sent with the pasted key

  @integration
  Scenario: Say so when the reader declines a request in the frame
    Given the frame is connected
    When I send a request that the reader then cancels in the frame
    Then the playground says the request was not sent

  @integration
  Scenario: End the connection when I leave the page
    Given the frame is embedded
    When I leave the page
    Then the frame is removed, which ends its connection

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
