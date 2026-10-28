Feature: The docs session frame keeps the key on the app's origin
  The docs carry analytics, so a docs session key never enters the docs page. A small frame
  on the app's origin holds it, runs the consent flow and sends the requests. See ADR-185,
  amendment of 2026-10-28.

  @integration
  Scenario: Only a registered docs origin may frame the session frame
    Given a registered docs origin and an unregistered origin
    When each asks for the session frame
    Then the registered origin gets the frame, which only that origin may embed
    And the frame allows only its own script and requests to the app's own origin
    And the unregistered origin gets a refusal page that nothing may embed

  @integration
  Scenario: Connecting runs the consent flow from inside the frame
    Given the frame is embedded by a registered docs origin
    When the reader presses Use my LangWatch account in the frame
    Then the app's consent page opens in a popup with a fresh single-use state
    When the popup answers that state with a granted key
    Then the frame tells the docs page it is connected in that project
    And the docs page is never sent the key

  @integration
  Scenario: The frame ignores any answer that is not the expected one
    Given the frame is waiting for the consent popup
    When a message arrives from another origin, another window, another state or with a malformed body
    Then it is ignored and the frame keeps waiting

  @integration
  Scenario: The frame reports why connecting did not work
    When the popup is blocked, closed before answering, denied, or silent for two minutes
    Then the frame says which happened
    And the docs page is told it is not connected, so the pasted key stays in use

  @integration
  Scenario: The frame sends a read for the docs page at once
    Given the frame is connected
    When the docs page asks it to send a GET to a path under /api
    Then the frame sends it to the app's own origin with the key as X-Auth-Token and no cookies
    And answers the docs page with the response

  @integration
  Scenario: A request that changes data waits for the reader inside the frame
    Given the frame is connected
    When the docs page asks it to send a POST
    Then the frame names the method, the path and the project, and waits
    And it sends the request only when the reader presses Send in the frame
    And a press that comes too soon after the confirmation appears is ignored
    And Cancel answers the docs page that the reader declined

  @integration
  Scenario: The frame refuses what it was not built to send
    Given the frame is connected
    When a message from anywhere but its parent at the docs origin asks it to send a request
    Or the docs page asks for a path outside /api, another origin, or an unknown method
    Then nothing is sent
    And credentials the docs page names in the request are dropped before sending

  @integration
  Scenario: The frame ends the connection when access ends
    Given the frame is connected
    When the key expires, a request answers 401, the reader disconnects, or the frame unloads
    Then the key is cleared and the docs page is told it is not connected
    And disconnecting or unloading asks the app to revoke the key
    And when a request answers 403 the frame says the reader's access does not allow it
