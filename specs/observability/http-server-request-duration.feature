Feature: Inbound HTTP requests are timed by route template

  An engineer asks for each service's error ratio and p95. The answer must not
  turn a raw path into a metric series, so every label is bounded.

    # Bindings: packages/api/src/hosting/__tests__/http-mux.metrics.unit.test.ts
    # Sender: packages/api/src/hosting/http-mux.ts

  @unit
  Scenario: A request is recorded under its mount prefix, method and status
    Given a mux with an api mount and a page mount
    When a POST to a deep api path is answered with a 503
    Then one duration is recorded with the mount prefix, the method and the status code
    And the raw path appears in no label

  @unit
  Scenario: A router that matched a template replaces the mount prefix
    Given an inner router notes the template it matched
    When a request for a concrete path is served
    Then the duration is recorded under the template

  @unit
  Scenario: An unknown method collapses into one series
    Given a request with a method outside the standard set
    When the request is served
    Then the duration is recorded under the method "_OTHER"

  @unit
  Scenario: A route that throws is recorded as a server error
    Given a route that throws
    When a request reaches it
    Then the duration is recorded with status code 500
