Feature: Haven dev orb
  As a developer or a coding agent building on a stack haven runs
  I want a floating orb in the app with dev tools and a feedback channel into haven
  So that I can switch theme, reach the stack's consoles and hand page feedback to an agent

  The orb is dev-server tooling: the ui lane's Vite plugin injects it into the page only
  when haven runs the stack, and it takes no part in a production build.

  Scenario: absent when not run by haven
    Given the dev server runs without haven's stack slug
    When it serves the app page
    Then the page carries no orb script

  Scenario: absent in production
    When the app is built for production
    Then the orb plugin takes no part in the build

  Scenario: present when haven runs the stack
    Given haven runs the stack "feat-x"
    When the dev server serves the app page
    Then the page loads the orb script before the app's own

  Scenario: the panel lists the stack's facts and consoles
    Given haven runs the stack "feat-x" with mailsim
    When the reader opens the orb
    Then the panel shows the slug, branch and commit
    And it links the hub, this stack's logs page and the mail console

  Scenario: the theme switch follows the reader's choice
    Given the orb panel is open
    When the reader picks "dark"
    Then the app stores "dark" as its theme and switches to it

  Scenario: hiding the orb lasts for the tab's session
    When the reader hides the orb
    Then the orb stays hidden until the tab's session ends

  Scenario: feedback on a picked element reaches haven
    Given the reader picked an element and wrote a note
    When the reader sends the feedback
    Then haven stores it with the page URL, the element's selector, the note and the viewport
    And it carries the page's recent console messages and requests

  Scenario: feedback on a selected region reaches haven
    Given the reader dragged a rectangle over the page and wrote a note
    When the reader sends the feedback
    Then haven stores it with the region's box and the note

  Scenario: network capture never records bodies or headers
    Given the page sends a request with a body, an authorization header and a query token
    Then the captured entry holds only its method, its URL without the query, its status and its duration

  Scenario: console capture leaves the console's output unchanged
    When the page logs an error
    Then the console prints it as before
    And the buffer holds it with level "error"

  Scenario: the page buffer stays bounded
    When the page logs more than 200 messages
    Then the buffer holds the newest 200

  Scenario: haven refuses orb posts from another origin
    When a page on another origin posts feedback for the stack "feat-x"
    Then haven answers 403 and stores nothing

  Scenario: an agent lists open feedback
    Given haven holds two feedback items for the stack, one resolved
    When the agent runs "haven feedback list --open --json"
    Then it receives the open item alone

  Scenario: an agent resolves feedback
    Given haven holds an open feedback item
    When the agent runs "haven feedback resolve <id>"
    Then the item is no longer open

  Scenario: an agent waits for new feedback
    Given the agent runs "haven feedback wait --timeout 5s"
    When a reader sends feedback
    Then the wait returns that item

  Scenario: an agent reads the page's console errors
    Given the orb pushed the page buffer to haven
    When the agent runs "haven page console --level error --json"
    Then it receives the error messages alone

  Scenario: an agent reads the page's failed requests
    Given the orb pushed the page buffer to haven
    When the agent runs "haven page network --failed --json"
    Then it receives the failed requests alone
