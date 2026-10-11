Feature: Read and navigate the generated documentation
  The site presents the existing MDX and only the API operations listed in docs.json.

  @unimplemented
  Scenario: Publish only the configured API inventory
    Given an OpenAPI document contains listed and unlisted operations
    When the documentation is built
    Then only listed operations have pages and search entries
    And the authored navigation order is preserved

  @unimplemented
  Scenario: Read diagrams without JavaScript
    Given a page contains a Mermaid diagram
    When the page is built
    Then its HTML contains light and dark SVG diagrams
    And its source is available in a disclosure

  @unimplemented
  Scenario: Copy a skill prompt
    Given a page contains a generated skill accordion
    When a reader copies the full prompt
    Then the clipboard contains its complete authored prompt
    And the card reports that copying succeeded

  @unimplemented
  Scenario: Recover from an unknown route
    When a reader opens an unknown documentation route
    Then the server returns a 404 page in the documentation shell
    And the reader can open search or follow a starting-point link

  @unimplemented
  Scenario: Inspect an API request before sending
    Given a reader opens Try it on an authenticated endpoint
    Then the API key field is visible and masked
    And no request is sent until the reader chooses Send request
    And missing required values prevent sending
