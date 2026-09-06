Feature: Gateway Prometheus metrics

  # Scenarios here describe the operator-facing metrics surface of the Go
  # gateway service (services/aigateway). Verified via Go tests in
  # services/aigateway/adapters/gatewaymetrics/. Out of scope for the TS
  # parity check.

  A self-hosted operator runs the gateway with no access to LangWatch's
  own dashboards. Prometheus is the only way they can see whether their
  gateway is healthy, which provider is failing, and whose budget or
  guardrail is rejecting traffic. The published docs are the contract:
  whatever the observability pages tell an operator to scrape has to
  exist, carry the labels the docs promise, and move when the thing it
  describes happens.

  Rule: the gateway is scrapeable without authentication

    Scenario: an operator scrapes the gateway
      Given a running gateway
      When the operator scrapes the metrics endpoint
      Then the response is a Prometheus text exposition
      And no credential was required

    Scenario: scraping is not exposed to customer traffic
      Given a running gateway
      Then the metrics endpoint is served on the same port as the API
      And it is excluded from the public ingress so only the cluster's
        scraper can reach it

    Scenario: process and runtime health are visible alongside gateway metrics
      Given a running gateway
      When the operator scrapes the metrics endpoint
      Then goroutine, memory and file-descriptor metrics are present
      So the standard on-call toolkit works without extra wiring

  Rule: every metric the docs promise is actually registered

    # This is the regression guard. The metrics package was deleted once
    # in a restructure while the docs kept advertising it, and a
    # self-hoster following our own observability page scraped an
    # endpoint that was not served and got nothing back, with no error
    # explaining why.

    Scenario: a documented metric is missing from the gateway
      Given the observability documentation names a metric
      When that metric is not registered by the gateway
      Then the build fails and names the missing metric

    Scenario: a metric is renamed without updating the docs
      Given a registered metric is renamed
      When the documentation still names the old metric
      Then the build fails

    Scenario: the documented metric survives a restructure
      Given the gateway service is reorganised
      Then an operator's existing dashboards and alerts keep resolving
      Because the documented names are asserted, not incidental

  Rule: metrics report real traffic, not zeroes

    # A metric that exists but never moves is barely better than a
    # missing one: the dashboard still reads "nothing is happening".

    Scenario: a completed request is counted and timed
      Given a virtual key with a working provider
      When a caller completes a chat completion
      Then the request is counted against its route, outcome, provider
        and model
      And its end-to-end latency is recorded
      And the upstream provider's own round-trip is recorded separately
        so an operator can tell gateway overhead from provider slowness

    Scenario: requests in progress are visible while they run
      Given several long-running completions are in flight
      When the operator scrapes the metrics endpoint
      Then the in-flight count reflects the requests still executing
      And it returns to zero once they finish

    Scenario: a rejected request is counted with the reason it was rejected
      Given a virtual key that is over its budget
      When a caller sends a request
      Then the request is counted as a budget rejection for the breached
        scope
      And the same request is counted against its failing outcome on the
        request counter

    Scenario: a rate-limited request records which ceiling it hit
      Given a virtual key limited by requests per minute
      When a caller exceeds that ceiling
      Then the denial is counted against the per-minute dimension
      And a caller exceeding the daily ceiling is counted separately

    Scenario: guardrail decisions are counted by direction and verdict
      Given a virtual key with guardrails on requests and responses
      When guardrails allow one call and block another
      Then each verdict is counted against the direction it was evaluated
        in
      And a guardrail the gateway could not reach is counted as a
        fail-open rather than silently as an allow

    Scenario: falling back to another provider is visible
      Given a fallback chain whose first provider is failing
      When a caller sends a request that succeeds on the second provider
      Then the failed attempt is counted with the reason it was abandoned
      And the successful attempt is counted as a fallback
      And the move from the failing credential to the winning one is
        counted so an operator can see which chains carry the traffic

    Scenario: a provider that keeps failing is reported as cut off
      Given a provider that has failed repeatedly
      When its circuit opens
      Then the circuit state for that credential is reported
      And requests skipped by the open circuit are counted as such
      And the state returns to closed after the provider recovers

    Scenario: authentication cache effectiveness is visible
      Given repeated requests on the same virtual key
      When the operator scrapes the metrics endpoint
      Then hits and misses are counted per cache tier
      And the number of cached keys is reported
      So an operator can tell a cold cache from a control plane that is
        rejecting lookups

    Scenario: control plane round trips are timed
      Given the gateway resolves a key against the control plane
      When the operator scrapes the metrics endpoint
      Then the round-trip time is recorded against the endpoint that was
        called
      And its outcome is counted
      So a slow control plane is distinguishable from a slow provider

    Scenario: prompt-cache effectiveness is visible
      Given a provider that served part of a request from its prompt
        cache
      When the request completes
      Then the request is counted as a cache hit
      And a request the provider served without any cached tokens is
        counted as a miss

    Scenario: a cache-control rule that fires is attributed to the rule
      Given an operator-defined cache-control rule
      When a request matches it
      Then the hit is counted against that rule and the mode that was
        finally applied

    Scenario: a stream that ends without usage is counted
      Given a streaming request whose provider reports no token usage
      When the stream closes
      Then the request is counted as missing usage for that provider and
        model
      Because a stream with no usage debits nothing and silently bypasses
        budget enforcement

    Scenario: active streams are visible while they run
      Given streaming completions are in progress
      When the operator scrapes the metrics endpoint
      Then the count of open streams is reported
      And it returns to zero once they close

  Rule: draining is observable so a rollout can be trusted

    Scenario: an operator watches a pod drain
      Given a gateway pod that has been told to shut down
      When the operator scrapes it during the grace period
      Then it reports that it is draining
      And the in-flight count falls towards zero
      So a stuck handler is distinguishable from a pod that has simply
        stopped receiving traffic

  Rule: label cardinality stays bounded

    # Labels are the easy way to take a pod down: one unbounded label
    # value multiplies every series by the size of its domain.

    Scenario: request labels use route patterns, not raw paths
      Given requests to a route that embeds a model name in its path
      When those requests are counted
      Then they collapse onto the route's pattern rather than creating a
        series per path

    Scenario: caller-controlled values do not become labels
      Given a virtual key permitting arbitrary model names
      When a caller sends an unrecognised model
      Then no new series is created for that caller-supplied value
