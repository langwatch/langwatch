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

  @integration
  Scenario: Explain a search that fails to render
    Given the search dialog is open
    When rendering the results fails
    Then the dialog says search stopped working and how to carry on
    And the rest of the page keeps working

  @unit
  Scenario: Reuse the parsed search index and retry a failed load
    Given search loaded the index for the current build
    When the reader closes and reopens search
    Then the index is not fetched or parsed again
    And after a failed load, Retry fetches it again
    And a build whose search index changed has a new build version, so no reader keeps an old index

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
  Scenario: Serve authored screenshots as modern images
    Given a guide shows a local PNG, JPEG or WebP image
    When the site is built
    Then the page offers AVIF and WebP encodings of it in a picture, at the article column's width and twice it
    And the image element names the largest WebP encoding, so the original is not published
    And the image keeps its intrinsic width and height
    And no encoding wider than twice the article column or larger than the original is published
    And no encoding carries the original's metadata
    And unchanged images are reused from the build cache, and cache entries no build uses are removed
    But SVG, GIF, external and already responsive images are left as authored

  @unit
  Scenario: Serve videos as small web encodings with a poster
    Given a guide plays a local video
    When the site is built
    Then the video offers an AV1 WebM and an H.264 MP4, each naming its codecs
    And neither is wider than twice the article column or plays more than 30 frames a second
    And a source without sound publishes no audio track
    And a video without an authored poster shows a WebP of its first frame and fetches nothing until it plays
    And it autoplays only where authored and muted
    And unchanged videos are reused from the build cache instead of being encoded again
    But without ffmpeg the video is published as authored

  @unit
  Scenario: Name every published media file by its content
    Given the pages reference authored images, videos, posters, downloads and fonts
    When the site is built
    Then each is published under a name carrying a hash of its content, and every page and agent export names that file
    And a host may cache any file so named for a year
    And authored media no page or agent export references is left out of the build
    But the logos, the favicon and the social card keep their authored names, because other sites and browser scripts ask for them by name

  @unit
  Scenario: Preload the first image a reader sees
    Given a page's first article image sits above the fold
    When the page is prerendered
    Then that image loads eagerly at high priority and the page head preloads its AVIF encoding
    And a light and dark pair preloads each variant for its colour scheme without fetching the hidden one
    And every other article image loads lazily and decodes asynchronously
    But an image below the fold, in a closed disclosure or in a hidden tab is never preloaded

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

  @integration
  Scenario: Load an embedded YouTube player only when the reader presses play
    Given a guide embeds a YouTube video
    When the page loads
    Then it shows a play button in the video's frame and loads nothing from YouTube
    When the reader presses play
    Then the privacy-enhanced player replaces the button and starts playing

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
    And the desktop page list sticks beneath the header and scrolls on its own
    And following a page list link keeps that link in view
    And a short contents rail may stick beneath the header
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
  Scenario: Answer a first click on search, a context menu or the playground on a small download
    Given search and the page menu fill markup already drawn into the page
    And the playground renders on a React compatible runtime a tenth of React's size
    When a reader first opens search, the page menu, or the API playground
    Then search downloads at most 6,000 gzip bytes of script before it answers
    And the page menu downloads at most 3,000
    And the playground downloads at most 24,500
    And the page itself still loads under 3,000 gzip bytes of script before any interaction

  @e2e
  Scenario: Use the shared command surface
    When a reader opens search with the keyboard or search button
    Then pages are grouped by section with matching headings and API methods
    And arrow keys and Enter choose a result and Escape restores focus
    And quick actions can change the theme and copy the page

  @e2e
  Scenario: Use clear contextual menus
    When a reader opens the page menu or presses the theme button
    Then page actions have readable titles and descriptions
    And copying a page confirms success
    And the theme button switches between light and dark and the page remembers the choice

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

  @integration
  Scenario: Show a group of one page as that page's link
    Given a navigation group holds exactly one page and no other root
    When the page tree renders
    Then the group shows as one link to that page, with the group's name and icon
    And it has no chevron and no nested panel

  @unit
  Scenario: Brand a page only with the logo every card linking to it shows
    Given overview cards link to a page
    When one card shows a brand logo and another card linking there shows a different icon
    Then the page and its group get no logo in the page tree

  @e2e
  Scenario: Keep text in place while the web fonts load
    Given the web fonts reach the reader after the page has painted
    When a reader opens a section index or a guide
    Then the text set in the metric-matched fallback fonts takes the same space as the web fonts
    And the page shifts by no more than 0.01 when the fonts swap in

  @e2e
  Scenario: Keep an API reference in place while the page starts
    Given a reader opens an API reference on a phone or a desktop
    When the page's script starts after the first paint
    Then the request and response examples keep the state they painted in
    And the page shifts by no more than 0.01

  @e2e
  Scenario: Keep every page template in place while it starts
    Given the web fonts and the scripts reach the reader after the page has painted
    When a reader opens one page of each template on a phone and on a desktop
    Then each page shifts by no more than 0.01
    And a page that moves is named with its width, its shift and the elements that moved

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

  @integration
  Scenario: Ship a skill prompt's rendered body as its own fragment
    When the build publishes a page with skill cards
    Then each card's prompt disclosure carries a short preview and a link to the prompt's Markdown file
    And the full rendered body is written once to a content-hashed fragment that caches like other hashed assets
    And a page served without that step still carries the full rendered body
    And the link check and the published inventory read each fragment as part of the page that names it

  @integration
  Scenario: Fill a skill prompt from its fragment the first time it opens
    Given JavaScript is enabled
    When a reader opens a skill prompt's disclosure, before or after its script has loaded
    Then the rendered body is fetched once and replaces the preview while the disclosure stays open
    And the copy buttons of its code blocks work like the rest of the page's
    And a failed fetch keeps the preview and link and is retried on the next open

  @unit
  Scenario: Publish the search index with each article word once
    Given every page's rendered search entry
    When the build publishes search-index.json
    Then it holds one entry per page in navigation order, with no article text written out in full
    And each distinct article word is written once for the whole site, with the pages it appears on
    And a word already in the page's title, description, address or headings is not repeated for that page
    And a heading carries its anchor only when the anchor differs from the one its text implies
    And the published index is a fraction of the size of the article text it replaces

  @unit
  Scenario: Find the same pages from the compact index
    Given the published search index
    When a reader searches a title, a heading, a word or word prefix only in the article, an API path, an environment variable, a property or a misspelling
    Then the same pages are found, ranked as before, with the heading anchor for heading matches
    And punctuation around a term is ignored, but punctuation inside it, as in an API path or a dotted name, must match
    But a page missing any query term is not found

  @unit
  Scenario: Open search on the prerendered command bar
    Given every page carries the design system's command bar as inert markup, styled by the page stylesheet
    When a reader opens search
    Then the search island fills that markup in a native modal dialog
    And it loads no component runtime and no design system code

  @integration
  Scenario: Open the page menu on its prerendered markup
    Given every page carries the design system's page actions menu as inert markup beside its trigger
    When a reader opens the page menu with a pointer or the keyboard
    Then the menu shows as a popover below the trigger, with arrow keys, Home, End, Enter and Escape working
    And it loads no component runtime and no design system code

  @unit
  Scenario: Load the search engine without a schema library
    When a reader opens search
    Then the search island and the code it loads include no schema validation library
    And a malformed or truncated search index fails to load, so Retry can fetch it again

  @unit
  Scenario: Keep a page's own heading anchors when a skill prompt repeats a heading
    When a page's skill prompt has a heading named like one of the page's own sections
    Then the page's section keeps the plain anchor its links point at
    And the prompt's heading takes a numbered anchor
