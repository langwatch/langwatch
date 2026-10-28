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

  @unit
  Scenario: Suggest the closest pages for a missing address
    Given no redirect matches a missing address such as "/integration/pyhton/langchain"
    When the reader opens it
    Then the 404 page lists the closest pages, best first and navigation order on ties
    And a misspelt word still matches its page
    And an address with no recognisable word lists no suggestions

  @unit
  Scenario: Mark a missing address with the section it sits in
    Given a missing address under a section's path, such as "/api-reference/retired-endpoint"
    When the reader opens it
    Then the 404 page is marked with that section, even when no page title matches
    And an address under no section's path takes the section of its closest page
    And an address with neither carries no section

  @unit
  Scenario: Act out a miss in the way of its section
    Given a missing address under API reference, SDK and integration, CLI, skills, coding agent, AI gateway, self-hosting or changelog pages
    Then the 404 page is a Langy Code terminal session that fails to fetch the address
    Given a missing address under a product guide, such as evaluations, agent testing, prompts, datasets, Langy or governance
    Then the 404 page is a trace of the page request whose page_exists evaluation fails
    Given any other missing address, or one with no section
    Then the 404 page shows a castle whose one turret is the LangWatch mark
    And each scene offers the three closest pages as numbered links

  @unit
  Scenario: Search from the 404 page with the missing address's words
    When the reader types in the scene's input or presses "/"
    Then the search bar opens, filled with the words of the missing address

  @e2e
  Scenario: Show the scene and closest pages for a missing address
    Given the built site served with a 404 status for unknown addresses
    When a reader opens a missing API reference address and a missing product guide address
    Then each page is marked noindex, shows the terminal or the trace, and links to its closest pages
    And pressing 1 opens the first of them
    And the page has one h1, the rail of ways out, and no sideways scroll at 390 pixels

  @e2e
  Scenario: Inspect an API request before sending
    Given a reader opens Try it on an authenticated endpoint
    Then the API key field is visible and masked
    And no request is sent until the reader chooses Send request
    And missing required values prevent sending

  @unit
  Scenario: Colour the request body like the docs' code blocks
    Given a reader edits a JSON request body in Try it
    Then keys, strings and other values take the code blocks' colours as they type
    And text that is not yet valid JSON is still shown, uncoloured where it cannot be read

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

  @unit
  Scenario: Component titles before the first section never skip a heading level
    Given an MDX page with steps, cards or skill cards before its first second-level heading
    When the page is compiled
    Then those titles are second-level headings, unless the author set their level
    And the same components after the first second-level heading keep third-level titles

  @unit
  Scenario: Name each task list checkbox by its item
    Given an MDX page with a task list
    When the page is compiled
    Then each item's checkbox is labelled with the item's text

  @unit
  Scenario: Head each row of a table whose corner cell is empty
    Given an MDX table whose first header cell is empty
    When the page is compiled
    Then the first cell of each row is a header for that row
    And a table with a filled first header cell is left alone

  @integration
  Scenario: Tab panels are named by ids without spaces
    Given authored tabs or a code group whose labels contain spaces
    When the page is rendered
    Then each tab's aria-controls names exactly one panel id
