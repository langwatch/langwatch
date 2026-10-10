Feature: Haven dev orb
  As a developer or a coding agent building on a stack haven runs
  I want a floating orb in the app with dev tools and a feedback channel into haven
  So that I can reach the stack's consoles and hand page feedback to an agent

  The orb is dev tooling: on a dev-server stack the ui lane's Vite plugin injects it; on a
  built-UI stack the dev runtime, which owns the api's port, injects it into the built page
  (ADR-064, 2026-10-10). Either way only when haven runs the stack, and never in a build.

  @integration
  Scenario: absent when not run by haven
    Given the dev server runs without haven's stack slug
    When it serves the app page
    Then the page carries no orb script

  @integration
  Scenario: absent in production
    When the app is built for production or for haven's local build cache
    Then the orb plugin takes no part in the build
    And the orb's own build is held in memory and writes nothing to disk

  @integration
  Scenario: present on a built-UI stack haven runs
    Given haven runs the stack "feat-x" with the UI built
    When the api's port serves the app page
    Then the page loads the orb script, built apart from the app's bundle
    And every other answer and upgrade passes through unchanged
    And a page is served as it is when the orb could not be built

  @integration
  Scenario: absent from a built-UI stack haven does not run
    Given the dev runtime serves the api without haven's stack slug, or beside the dev server
    Then the api's port adds no orb

  @integration
  Scenario: present when haven runs the stack
    Given haven runs the stack "feat-x"
    When the dev server serves the app page
    Then the page loads the orb script before the app's own

  @integration
  Scenario: the panel lists the stack's facts and consoles
    Given haven runs the stack "feat-x" with mailsim
    When the reader opens the orb
    Then the panel shows the slug, branch and commit
    And it links the hub, this stack's logs page and the mail console
    And a database's bare host and port is offered to copy, not as a link

  @integration
  Scenario: the orb shows each service's health
    Given haven runs the stack "feat-x" with mailsim
    When the reader opens the orb
    Then each service row carries the status the stack home shows for it
    And the services sit in groups: Stack open, Sims, Data and Tools folded

  @integration
  Scenario: hiding the orb lasts for the tab's session
    When the reader hides the orb
    Then the orb stays hidden until the tab's session ends

  @integration
  Scenario: feedback on a picked element reaches haven
    Given the reader picked an element and wrote a note
    When the reader sends the feedback
    Then haven stores it with the page URL, the element's selector, the note and the viewport
    And it carries the page's recent console messages and requests

  @integration
  Scenario: feedback on a selected region reaches haven
    Given the reader dragged a rectangle over the page and wrote a note
    When the reader sends the feedback
    Then haven stores it with the region's box and the note

  @integration
  Scenario: the orb docks to Langy's launcher
    Given Langy's launcher sits in a bottom corner
    When the orb renders
    Then it sits as a small glass satellite on the launcher's upper rim, on the side facing the page
    And its panel morphs out of the satellite

  @integration
  Scenario: the orb stands alone without Langy's launcher
    Given the page has no Langy launcher
    When the orb renders
    Then it sits as a glass orb 20px off the bottom-right corner

  @integration
  Scenario: the orb waits for the app to paint
    Given the app has not rendered into the page yet
    Then the orb is not shown
    And the page buffer already records the page's requests

  @integration
  Scenario: the orb stays clickable above the app's overlays
    Given the app has loaded with its fixed layers and overlays
    When the reader clicks the orb
    Then the click reaches the orb

  @integration
  Scenario: the element picker labels what it would pick
    Given the reader chose "Pick element"
    When the pointer rests on an element with a test id
    Then a soft highlight outlines it with a label naming its component, test id and size
    And Escape cancels the pick without touching the page

  @integration
  Scenario: a capture of the selection travels with the note
    Given the reader picked an element and the orb captured an image of it
    When the reader sends the feedback
    Then the note carries the capture as a PNG

  @unit
  Scenario: haven stores the capture beside the note
    Given a note arrives with a PNG capture
    Then haven stores the PNG beside the note and names its path
    And refuses a capture that is not a PNG

  @integration
  Scenario: the panel says plainly when haven does not answer
    Given haven does not answer the orb
    When the reader opens the orb
    Then the panel says so in one line with a retry
    And retrying, reopening the orb or waiting 30 seconds asks haven again

  @integration
  Scenario: network capture never records bodies or headers
    Given the page sends a request with a body, an authorization header and a query token
    Then the captured entry holds only its method, its URL without the query, its status and its duration

  @integration
  Scenario: console capture leaves the console's output unchanged
    When the page logs an error
    Then the console prints it as before
    And the buffer holds it with level "error"

  @integration
  Scenario: the page buffer stays bounded
    When the page logs more than 200 messages
    Then the buffer holds the newest 200

  @integration
  Scenario: haven refuses orb posts from another origin
    When a page on another origin posts feedback for the stack "feat-x"
    Then haven answers 403 and stores nothing

  @unit
  Scenario: an agent lists open feedback
    Given haven holds two feedback items for the stack, one resolved
    When the agent runs "haven orb feedback list --open --json"
    Then it receives the open item alone

  @unit
  Scenario: an agent resolves feedback
    Given haven holds an open feedback item
    When the agent runs "haven orb feedback resolve <id>"
    Then the item is no longer open

  @unit
  Scenario: an agent waits for new feedback
    Given the agent runs "haven orb feedback wait --timeout 5s"
    When a reader sends feedback
    Then the wait returns that item

  @unit
  Scenario: an agent reads the page's console errors
    Given the orb pushed the page buffer to haven
    When the agent runs "haven orb console --level error --json"
    Then it receives the error messages alone

  @unit
  Scenario: an agent reads the page's failed requests
    Given the orb pushed the page buffer to haven
    When the agent runs "haven orb network --failed --json"
    Then it receives the failed requests alone
