Feature: Haven dev orb
  As a developer or a coding agent building on a stack haven runs
  I want a floating orb in the app with dev tools and a feedback channel into haven
  So that I can switch theme, reach the stack's consoles and hand page feedback to an agent

  The orb is dev-server tooling: the ui lane's Vite plugin injects it into the page only
  when haven runs the stack, and it takes no part in a production build.

  @integration
  Scenario: absent when not run by haven
    Given the dev server runs without haven's stack slug
    When it serves the app page
    Then the page carries no orb script

  @integration
  Scenario: absent in production
    When the app is built for production
    Then the orb plugin takes no part in the build

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

  @integration
  Scenario: the theme switch follows the reader's choice
    Given the orb panel is open
    When the reader picks "dark"
    Then the app stores "dark" as its theme and switches to it

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
  Scenario: the orb sits clear of Langy's launcher
    Given Langy's launcher sits in the bottom-right corner
    When the orb renders
    Then it sits centred above the launcher, smaller, in the same round surface family

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
    And retrying asks haven again

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
    When the agent runs "haven feedback list --open --json"
    Then it receives the open item alone

  @unit
  Scenario: an agent resolves feedback
    Given haven holds an open feedback item
    When the agent runs "haven feedback resolve <id>"
    Then the item is no longer open

  @unit
  Scenario: an agent waits for new feedback
    Given the agent runs "haven feedback wait --timeout 5s"
    When a reader sends feedback
    Then the wait returns that item

  @unit
  Scenario: an agent reads the page's console errors
    Given the orb pushed the page buffer to haven
    When the agent runs "haven page console --level error --json"
    Then it receives the error messages alone

  @unit
  Scenario: an agent reads the page's failed requests
    Given the orb pushed the page buffer to haven
    When the agent runs "haven page network --failed --json"
    Then it receives the failed requests alone
