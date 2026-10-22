Feature: Read and navigate the generated documentation
  The site presents the existing MDX and only the API operations listed in docs.json.

  @e2e
  Scenario: Publish only the configured API inventory
    Given an OpenAPI document contains listed and unlisted operations
    When the documentation is built
    Then only listed operations have pages and search entries
    And the authored navigation order is preserved

  @e2e
  Scenario: Read diagrams without JavaScript
    Given a page contains a Mermaid diagram
    When the page is built
    Then its HTML contains light and dark SVG diagrams
    And its source is available in a disclosure

  @e2e
  Scenario: Copy a skill prompt
    Given a page contains a generated skill accordion
    When a reader copies the full prompt
    Then the clipboard contains its complete authored prompt
    And the card reports that copying succeeded

  @e2e
  Scenario: Recover from an unknown route
    When a reader opens an unknown documentation route
    Then the server returns a 404 page in the documentation shell
    And the reader can open search or follow a starting-point link

  @e2e
  Scenario: Inspect an API request before sending
    Given a reader opens Try it on an authenticated endpoint
    Then the API key field is visible and masked
    And no request is sent until the reader chooses Send request
    And missing required values prevent sending

  @e2e
  Scenario: Start with a coding agent
    Given the reader opens the introduction
    Then the product video appears before Quick Start
    And the video waits for the reader to start playback
    When the reader selects Claude Code, Codex or Cursor
    Then the setup instructions name the selected agent
    When the reader opens the full prompt preview
    Then the complete authored tracing prompt is readable
    When the reader copies the setup prompt
    Then the clipboard contains the full authored tracing prompt
    And the setup panel reports success

  @e2e
  Scenario: Recover from unavailable browser capabilities
    Given the introduction is open
    When clipboard access fails
    Then the setup panel links to the skills directory for manual copying
    When product video playback fails
    Then the poster and play control remain available
    And the reader sees a playback error

  @e2e
  Scenario: Navigate on a small screen
    Given the reader opens navigation on a small screen
    Then the section list and page tree appear in a modal drawer
    And the page tree can scroll to its final item
    And reduced motion disables the drawer animation
    When the reader presses Escape
    Then the drawer closes and focus returns to the navigation button

  @e2e
  Scenario: Keep clipboard controls unavailable before hydration
    Given the generated HTML is available before its JavaScript
    When a reader sees a page, code, skill or setup copy action
    Then the control is disabled until its browser handler is ready

  @integration
  Scenario: Step titles keep the page's heading order
    Given an MDX page whose steps set Mintlify's titleSize
    When the page is rendered
    Then each step title is a heading of that level, or plain text for "p"
    And steps without a size keep third-level titles
