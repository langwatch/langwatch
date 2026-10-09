Feature: The liveness door holds browsers on a static page while an upgrade runs

  With no old pods (compose, npx) the browser otherwise sees nothing until the
  upgrade run ends. The early liveness door serves an unauthenticated static
  "LangWatch is upgrading" page naming the phase and the outstanding step ids
  only: no tenant, error, hostname or version detail (Q-U4, plan
  dev/docs/plans/upgrade-ui-2026-10-06.md). A held request first waits up to
  the hold window (30 s) for the hold to lift or its route to serve, so a short
  schema step drops nothing (Alex, 2026-10-09, API-UP-DURING-UPGRADE); only a
  request still held when the window ends sees the page or the 503.

  @unit
  Scenario: A browser sees the holding page while an upgrade holds the door
    Given the liveness thread is holding for an upgrade in the "schema" phase with two outstanding steps
    When a browser requests any page with an Accept header naming text/html
    And the hold window ends with the hold still in place
    Then it answers 503 with an HTML page naming the phase and both step ids
    And it carries a Retry-After header and is never cached

  @unit
  Scenario: An API caller keeps a plain 503 with a retry header while an upgrade holds the door
    Given the liveness thread is holding for an upgrade
    When a JSON client requests an API path
    And the hold window ends with the hold still in place
    Then it answers 503 in plain text with a Retry-After header
    And the main thread never sees the request

  @unit
  Scenario: The holding page escapes everything it renders
    Given an upgrade whose phase and step ids carry HTML markup
    When the holding page is rendered
    Then the markup appears escaped and no tag from the input survives

  @unit
  Scenario: Liveness still answers while an upgrade holds the door
    Given the liveness thread is holding for an upgrade
    When the kubelet requests the liveness path
    Then it answers 200

  @unit
  Scenario: Lifting the hold sends requests to the main thread again
    Given the liveness thread was holding for an upgrade
    When the hold is lifted
    Then a request is proxied to the main thread again

  @unit
  Scenario: A WebSocket upgrade is refused while an upgrade holds the door
    Given the liveness thread is holding for an upgrade
    When a client asks to upgrade a connection to a WebSocket
    Then it answers 503 with a Retry-After header
    And the main thread never sees the connection

  @unit
  Scenario: The upgrading holding page offers sign-in to follow the upgrade
    Given the api serves in upgrading mode
    When the holding page is rendered
    Then it links to sign-in with a callback to the Upgrades page
    And the holding page of the schema phase carries no link

  @unit
  Scenario: The holding page names only the phase when no step is outstanding
    Given an upgrade with no outstanding step ids
    When the holding page is rendered
    Then it names the phase and shows no step list

  @unit
  Scenario: A waiting upgrade gate holds the door until it admits the process
    Given a process whose liveness thread is open and whose upgrade gate has not answered
    When a browser requests a page
    Then it sees the holding page naming the upgrade-gate phase
    And once the gate admits the process the request reaches the main thread

  @unit
  Scenario: A health route reaches the main thread while an upgrade holds the door
    Given the liveness thread is holding for an upgrade
    When the kubelet requests the api's health route
    Then the request is proxied to the main thread

  @unit
  Scenario: In upgrading mode every route passes the holding door but the held ones
    Given the liveness thread holds in upgrading mode with one route declared to hold
    When requests name other routes, pages and the held route's path with another method
    Then each reaches the main thread
    And the held route answers 503 before the main thread sees it

  @unit
  Scenario: A held request waits for the hold to lift and then reaches the main thread
    Given the liveness thread is holding for an upgrade
    When an SDK posts traces and the hold lifts within the hold window
    Then the request reaches the main thread and its answer is the main thread's
    And the SDK never sees the holding answer

  @unit
  Scenario: A held request is released once its route serves while upgrading
    Given the liveness thread is holding in the schema phase
    And an SDK has posted traces and a client has posted to a route that holds
    When the hold moves to the upgrading phase
    Then the trace request reaches the main thread
    And the held request is answered 503 when the hold window ends

  @unit
  Scenario: A flood of held requests past the cap is answered at once
    Given the liveness thread holds and as many requests wait as it parks
    When one more held request arrives
    Then it is answered 503 with a Retry-After header at once
    And the parked request still reaches the main thread when the hold lifts

  @unit
  Scenario: A released request reaches its handler only once the runtime has started
    Given the hold lifted while a component ahead of the api's runtime is still starting
    When a request reaches the main thread
    Then it waits, and its handler runs only after the runtime has started
