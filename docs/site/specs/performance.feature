Feature: Static documentation with progressive interaction
  @e2e
  Scenario: Read a styled guide without JavaScript
    Given JavaScript is disabled
    When a reader opens a guide or API reference
    Then its content, styles and examples are available

  @e2e
  Scenario: Navigate without replacing the shell
    Given a reader has opened the documentation
    When they follow an internal page link and then go back
    Then the content, title, location, focus and scroll reflect each page
    And the header remains mounted

  @e2e
  Scenario: Prefetch a likely destination
    When a reader hovers an internal documentation link
    Then its static HTML is fetched without navigating
    And following the link reuses that response

  @e2e
  Scenario: Update an offline cache safely
    Given a reader has installed the current documentation worker
    When a new build is deployed
    Then its versioned cache activates for the next navigation
    And previous cache versions are removed
    And a cached page works offline
    And uncached pages show the offline fallback
    And API requests and credentials are never cached

  @unit
  Scenario: Extract the exact server styles
    When a page is prerendered
    Then emitted style rules are extracted in order into a hashed stylesheet
    And executable rendering state is absent from its HTML

  @e2e
  Scenario: Send a request from a lazy playground
    Given the API playground has not loaded React
    When a reader opens it and sends an authorised trace request
    Then only that endpoint receives the entered key
    And the response is rendered
    And copied examples retain the key placeholder
    And navigating away clears the key

  @e2e
  Scenario: Scroll a long API section naturally
    Given an API introduction is open at a desktop or phone width
    Then the document scrolls without an inner content panel
    And a gradient gap separates the header and rounded paper
    And tall desktop rails flow with the document without an inner scrollbar
    And short rails may stick beneath the header
    And the full-width footer follows the panel and never clips navigation
    And Introduction and the section links start in view
    And operation names occupy no more than two lines

  @e2e
  Scenario: Use a static MDX disclosure
    When a reader opens a guide with an accordion
    Then its content expands with keyboard activation
    And it collapses again without loading a page renderer

  @e2e
  Scenario: Use the shared command surface
    When a reader opens search with the keyboard or search button
    Then pages are grouped by section with matching headings and API methods
    And arrow keys and Enter choose a result and Escape restores focus
    And quick actions can change the theme and copy the page

  @e2e
  Scenario: Use clear contextual menus
    When a reader opens the page or theme menu
    Then page actions have readable titles and descriptions
    And copying a page confirms success
    And the theme menu marks the current choice

  @e2e
  Scenario: Start with a coding agent
    When a reader chooses an agent and copies the setup prompt
    Then the picker identifies the selected agent with its brand mark
    And the complete authored prompt is copied with a success state
    And reduced motion keeps the background static

  @e2e
  Scenario: Render brand marks during development
    When a browser loads a brand SVG from the documentation dev server
    Then the response declares its SVG image type
    And the browser decodes the brand mark successfully
