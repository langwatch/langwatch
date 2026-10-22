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

  @unit
  Scenario: Paint a page from its own styles without waiting for a stylesheet
    Given the site's shared stylesheet holds every server and island rule
    When a page is prerendered
    Then the rules its markup can match are inlined in its head
    And rules for classes or ids found only on other pages are left out
    And rules a script can add at runtime, theme classes and unscoped rules are kept
    And the shared stylesheet loads without blocking the first paint

  @unit
  Scenario: Minify the shared stylesheet for the supported browsers
    When the server and island styles are combined into the shared stylesheet
    Then duplicate rules and prefixes the supported browsers no longer need are removed
    And prefixes those browsers still need are kept
    And its file name changes whenever its contents change

  @e2e
  Scenario: Keep dark mode and island styles on a page with inlined styles
    Given a page that inlines its own styles
    When a reader switches to dark mode, opens search and navigates to another page
    Then every surface is styled as before

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

  @integration
  Scenario: Open the mobile navigation from the page's one navigation tree
    Given a page ships its sections and page tree once, in the left rail
    When a reader opens the mobile navigation
    Then the drawer shows the same sections and page tree with the current page marked
    And no identifier on the page is repeated

  @integration
  Scenario: Draw navigation chevrons from shared styles
    When a page lists collapsible navigation groups
    Then each group toggle carries a styled chevron instead of its own inline icon
    And the chevron turns when the group opens

  @e2e
  Scenario: Keep text in place while the web fonts load
    Given the web fonts reach the reader after the page has painted
    When a reader opens a section index or a guide
    Then the text set in the metric-matched fallback fonts takes the same space as the web fonts
    And the page shifts by no more than 0.01 when the fonts swap in

  @e2e
  Scenario: Fetch only the fonts an English page draws
    When a reader opens an English page
    Then the body and title fonts are requested before the stylesheet asks for them
    And no extended-Latin font file is downloaded

  @unit
  Scenario: Preload the two fonts every page draws above the fold
    When a page head is built
    Then it preloads the Latin body font and the regular title font, under the site's base path, and no other font

  @integration
  Scenario: Serve the product tour poster at the size of the screen
    When the docs home renders the product tour
    Then its poster offers AVIF and WebP candidates by width, under the site's base path
    And the video keeps the poster's shape before and after the tour starts

  @e2e
  Scenario: Keep the agent carousel's faded names out of the contrast and reading order
    When a reader opens a page with the agent launcher
    Then the agent names in the wheel are drawn by the stylesheet, with no text for assistive technology or contrast checks
    And the chosen agent's name is still shown in the wheel

  @integration
  Scenario: Fetch a skill's full prompt from its own file instead of carrying it in the page
    When the build publishes a page with skill cards
    Then each card's copy button names a prompt file and carries no copy of the prompt
    And the prompt file holds exactly the text the button copied before
    And a page served without that step still copies the prompt from the button

  @integration
  Scenario: Copy a code block from the code it shows
    When a page renders a code block or a tabbed code group
    Then its copy button carries no second copy of the code
    And copying reads the code of the block, or of the selected tab, the button belongs to
    And a failed fetch or a denied clipboard reports that copying failed

  @unit @e2e
  Scenario: Follow the reader's dark preference without JavaScript
    Given JavaScript is disabled and the reader prefers a dark colour scheme
    When the reader opens a guide, the home page or an API reference
    Then the page renders in the dark theme, theme-paired images included
    And a reader preferring light still sees the light theme
    And readers with JavaScript download no extra stylesheet for it
