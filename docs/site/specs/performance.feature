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
    And the paper meets the header
    And desktop navigation sticks beneath the header
    And Introduction and the section links start in view
    And operation names occupy no more than two lines

  @e2e
  Scenario: Use a static MDX disclosure
    When a reader opens a guide with an accordion
    Then its content expands with keyboard activation
    And it collapses again without loading a page renderer
