Feature: Haven wait page for a service that is not answering
  As a developer with a browser tab open on a stack haven runs
  I want haven's own page while the service behind the tab is not answering
  So that the tab tells me what is happening and comes back by itself once the service is up

  portless answers a hard-coded "502 Bad Gateway" when a route's port is not listening, and
  it has no hook for a custom page. So the daemon re-points the route of a live stack's
  service at itself while the service's port is down, serves the wait page there, and points
  the route back at the service the moment its port listens again.

  @unit
  Scenario: a down service's route is pointed at the daemon
    Given a live stack "feat-x" whose app route points at the app's port
    And nothing listens on the app's port
    When the daemon reconciles the stack's routes
    Then the app route points at the daemon's port

  @unit
  Scenario: the route goes back once the service listens
    Given a live stack "feat-x" whose app route points at the daemon's port
    And the app's port is listening
    When the daemon reconciles the stack's routes
    Then the app route points at the app's port

  @unit
  Scenario: a route haven did not set is left alone
    Given a live stack "feat-x" whose app route points at another stack's port
    When the daemon reconciles the stack's routes
    Then the app route is not changed

  @unit
  Scenario: a stack whose launcher is gone is left to the reaper
    Given a stack "feat-x" whose launcher has exited
    When the daemon reconciles the stack's routes
    Then none of its routes are changed

  @unit
  Scenario: the daemon gives the routes back when it exits
    Given the app route of "feat-x" points at the daemon's port
    When the daemon exits
    Then the app route points at the app's port

  @unit
  Scenario: the wait page names the stack, the service and its state
    Given a live stack "feat-x" whose app is starting
    When a browser asks the daemon for "https://app.feat-x.langwatch.localhost/projects?tab=1"
    Then the answer is 503 with a Retry-After header
    And the page names the stack "feat-x", the service "app" and the state "starting"
    And the page links the hub and the stack's logs
    And the page carries no API key or credential

  @unit
  Scenario: the wait page polls and reloads the original address
    When a browser is served the wait page
    Then the page polls its own address, backing off from 1 second to 5 seconds
    And it reloads that address, path and query kept, once the answer is not haven's wait answer

  @unit
  Scenario: a non-page request gets a plain 503
    When a script asks the daemon for "https://api.feat-x.langwatch.localhost/api/health"
    Then the answer is 503 marked as haven's wait answer and is not an HTML page

  @unit
  Scenario: the daemon's own hosts are not wait pages
    When a browser asks the daemon for the hub or a stack home
    Then it is served the console, not the wait page
