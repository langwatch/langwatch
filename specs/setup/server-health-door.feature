Feature: The process boundary's built-in health door
  As an operator running any LangWatch Node process
  I want a health endpoint every process answers without composing one
  So that liveness and metrics scraping are the same shape everywhere

  # WHY THIS EXISTS
  #
  # Every process used to wire its own listener for `/healthz` and its own
  # Prometheus scrape gate, by hand, differently each time. `Server` now hosts
  # one built-in health door on every instance: `/healthz` answers with no
  # composition at all, and a component contributes further routes — like a
  # Prometheus scrape — onto the SAME listener through the one fluent word,
  # `.with(...)`. Metrics ownership moved to `@langwatch/observability`
  # (`prometheusMetrics({ token })`), so a process wires it the same way it
  # wires anything else this framework hosts.

  Background:
    Given a Server has been created

  Rule: The health door is on by default

    @unit
    Scenario: No health port is configured
      Given no health port was configured
      When the server starts
      Then "/healthz" answers 200 on an ephemeral port
      # Every process gets a health door for free, whether or not it composed
      # anything onto the server.

    @unit
    Scenario: A health port is configured
      Given a health port was configured
      When the server starts
      Then the health door binds that port

  Rule: A component contributes routes to the built-in door through .with()

    @unit
    Scenario: A route is mounted alongside the built-in door
      Given a component contributes a route at "/metrics" via .with()
      When that path is requested
      Then the component's own handler answers, on the same listener as "/healthz"

    @unit
    Scenario: .with() returns the server so calls chain
      When a component is mounted with .with()
      Then the same server instance is returned

  Rule: The Prometheus scrape door is token-gated

    @unit
    Scenario: A caller with the matching bearer token is served
      Given the observability metrics route is configured with a token
      When a caller scrapes "/metrics" with the matching bearer token
      Then the response is 200
      And the body is the exposition readMetrics produced

    @unit
    Scenario: A caller without the token is refused
      Given the observability metrics route is configured with a token
      When a caller scrapes "/metrics" with no or the wrong bearer token
      Then the response is 401

    @unit
    Scenario: No token configured serves an empty exposition by default
      Given the observability metrics route is configured with no readMetrics
      When a caller scrapes "/metrics"
      Then the response is 200 with a valid empty Prometheus exposition
      # For a process that exports its metrics through OTLP instead.

  Rule: Unknown paths are 404 on the health door

    @unit
    Scenario: An unrelated path is requested
      When a caller requests a path no route was contributed for
      Then the response is 404

  Rule: The health door outlives every drain

    @unit
    Scenario: A component drains while the health door stays reachable
      Given a hosted component is draining
      When "/healthz" is requested during that drain
      Then the response is still 200
      # The door is hosted first, so it stops last: a probe during shutdown
      # still sees the process as alive until every drain has finished.

    @unit
    Scenario: The door closes once every component has stopped
      Given the server has finished closing
      When "/healthz" is requested
      Then the request is refused
