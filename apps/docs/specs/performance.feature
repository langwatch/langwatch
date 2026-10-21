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
  Scenario: Keep a network response when the offline cache cannot store it
    Given the documentation worker controls a page under its scope
    When storing a fetched page or asset fails because storage is full
    Then the reader still receives the network response
    And requests outside the worker's base path are left to the browser
    And runtime pages and assets stay within their entry limits
    And the Latin-ext reading font is cached only after a page requests it

  @e2e
  Scenario: Reopen search offline
    Given a reader opened search while online
    When the search index for the current build was fetched as search-index.json?v=<build>
    And <build> is the version of the active documentation worker
    Then the worker serves that index from its cache when the reader reopens search offline
    But any other query string, another build's index or extra parameters beside v bypass the worker
    And at most one search index is ever cached

  @unit
  Scenario: Reuse the parsed search index and retry a failed load
    Given search loaded the index for the current build
    When the reader closes and reopens search
    Then the index is not fetched or parsed again
    And after a failed load, Retry fetches it again

  @unit
  Scenario: Find titles, headings, body-only words, API paths and properties, and near misses
    Given the loaded search index
    When a reader searches a title, a heading, a word only in the body, an API path, a property or a misspelling
    Then the page is found, with the heading anchor for heading matches

  @e2e
  Scenario: Hold back speculative prefetch
    Given a reader has asked the browser to save data
    When they hover or scroll past internal documentation links
    Then no page is fetched until they follow a link
    And without the preference a hover prefetches only after a short pause
    And no more than two speculative fetches run at once

  @unit
  Scenario: Reserve space for authored images
    Given a guide image from the docs media directories has no authored height
    When the page is compiled
    Then the image declares its intrinsic width and height
    But an authored width keeps its value and percentage widths are left alone

  @unit
  Scenario: Serve authored media from the docs mount
    Given the documentation is built under a base path
    When a page renders an authored image, responsive image, video, poster, source or embed
    Then each local URL, including every srcset candidate, carries the base path
    But external URLs and srcset descriptors are unchanged

  @e2e
  Scenario: Play an instructional clip in place of an animated GIF
    Given a guide shows a silent screen recording
    Then it loads a compressed video with a poster instead of a GIF
    And it plays muted and looped only while visible when motion is allowed
    And reduced motion keeps it paused on its poster with playback controls
    And without JavaScript the poster and controls remain available

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
    And the page sits flat on paper directly beneath the header
    And tall desktop rails flow with the document without an inner scrollbar
    And short rails may stick beneath the header
    And the full-width footer follows the page and never clips navigation
    And unrelated navigation groups start collapsed
    And the active page remains in an expanded branch
    And initial loading preserves the article heading and top gap
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

  @e2e
  Scenario: Render brand marks during development
    When a browser loads a brand SVG from the documentation dev server
    Then the response declares its SVG image type
    And the browser decodes the brand mark successfully
