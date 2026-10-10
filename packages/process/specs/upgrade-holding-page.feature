Feature: The liveness door holds nothing while an upgrade runs

  The api serves every route while the worker upgrades (Alex, 2026-10-09,
  NO-HOLDS): there is no holding page, no hold window and no held route. A
  Postgres read the schema is not ready for answers upgrade_in_progress (503
  with Retry-After) at the framework's error mapping; a ClickHouse read leaves
  out a column a pending step has not added. Only a failed first install, which
  nobody can sign in to follow, puts the token console in front of the routes
  (in-app-upgrade.feature).

  @unit
  Scenario: An upgrading api serves every request at once
    Given a process whose liveness thread is open and whose upgrade gate answers upgrading
    When a browser requests a page and an SDK posts traces
    Then each request reaches the main thread
    And the api reports not ready until the ledger is current

  @unit
  Scenario: A WebSocket upgrade reaches the main thread while the installation upgrades
    Given the liveness thread shows no console
    When a client asks to upgrade a connection to a WebSocket
    Then the main thread sees the connection

  @unit
  Scenario: An API caller keeps a plain 503 with a retry header while the console shows
    Given the liveness thread shows a failed first install's console
    When a JSON client requests an API path
    Then it answers 503 in plain text with a Retry-After header
    And the main thread never sees the request

  @unit
  Scenario: A WebSocket upgrade is refused while the console shows
    Given the liveness thread shows a failed first install's console
    When a client asks to upgrade a connection to a WebSocket
    Then it answers 503 with a Retry-After header
    And the main thread never sees the connection

  @unit
  Scenario: A health route reaches the main thread while the console shows
    Given the liveness thread shows the console with the api's health route passing
    When the kubelet requests the api's health route
    Then the request is proxied to the main thread

  @unit
  Scenario: Lifting the console sends requests to the main thread again
    Given the liveness thread showed a failed first install's console
    When the console is lifted
    Then a request is proxied to the main thread again

  @unit
  Scenario: A request that arrives while the runtime starts reaches its handler only once it has started
    Given a component ahead of the api's runtime is still starting
    When a request reaches the main thread
    Then it waits, and its handler runs only after the runtime has started
