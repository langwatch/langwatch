Feature: The liveness door holds browsers on a static page while an upgrade runs

  With no old pods (compose, npx) the browser otherwise sees nothing until the
  upgrade run ends. The early liveness door serves an unauthenticated static
  "LangWatch is upgrading" page naming the phase and the outstanding step ids
  only: no tenant, error, hostname or version detail (Q-U4, plan
  dev/docs/plans/upgrade-ui-2026-10-06.md).

  @unit
  Scenario: A browser sees the holding page while an upgrade holds the door
    Given the liveness thread is holding for an upgrade in the "schema" phase with two outstanding steps
    When a browser requests any page with an Accept header naming text/html
    Then it answers 503 with an HTML page naming the phase and both step ids
    And it carries a Retry-After header and is never cached

  @unit
  Scenario: An API caller keeps a plain 503 with a retry header while an upgrade holds the door
    Given the liveness thread is holding for an upgrade
    When a JSON client requests an API path
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
