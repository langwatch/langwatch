Feature: Worker liveness probe endpoint
  As an operator running LangWatch workers in Kubernetes
  I want a liveness endpoint the kubelet can call without credentials
  So that a wedged worker is restarted without exposing metrics to unauthenticated callers

  # WHY THIS EXISTS
  #
  # The worker process runs no web framework — its only HTTP listener is the
  # small metrics server on the worker metrics port (2999 by default). Before
  # this feature the Helm chart probed liveness with `exec: kill -0 1`, which
  # only proves PID 1 exists: a worker whose event loop is wedged still passes.
  #
  # The obvious next step — probe `GET /metrics` — does NOT work, for two
  # independent reasons, and both end in CrashLoopBackOff:
  #
  #   1. `/metrics` is fail-closed in production. With NODE_ENV=production and
  #      no METRICS_API_KEY (the chart default: app.telemetry.metrics.enabled
  #      is false, so the env var is never emitted) the auth gate THROWS and
  #      the endpoint answers 500 to every caller. A default install would
  #      crash-loop its workers.
  #   2. A kubelet httpGet probe cannot read a Kubernetes Secret. When the
  #      operator delivers METRICS_API_KEY via secretKeyRef, no rendered
  #      Authorization header can carry it, so the probe gets 401.
  #
  # Baking the token into the Deployment podspec as a plain httpHeader is not
  # an answer either: it copies a secret out of the Secret and into an object
  # readable by anyone with `get deploy`, and it still cannot cover case 1.
  #
  # So liveness gets its own endpoint. `/healthz` is unauthenticated by design
  # — it carries no telemetry, only the fact that the listener is accepting
  # connections and the event loop is turning. `/metrics` keeps its bearer gate
  # exactly as it was.

  Background:
    Given the worker process has finished booting its stack
    And the worker metrics server is listening

  Rule: /healthz answers unauthenticated, in every auth configuration

    @unit
    Scenario: Default install — no metrics API key in production
      Given the worker is running in production mode
      And no metrics API key is configured
      When the kubelet requests "/healthz" without an Authorization header
      Then the response status is 200
      # The case that would otherwise crash-loop every default install.

    @unit
    Scenario: Key configured, probe still sends nothing
      Given a metrics API key is configured
      When the kubelet requests "/healthz" without an Authorization header
      Then the response status is 200
      # Covers secretKeyRef delivery: the probe never needs the key at all.

    @unit
    Scenario: The liveness endpoint leaks no telemetry
      When the kubelet requests "/healthz"
      Then the response body does not contain any metric samples

  Rule: /metrics keeps its bearer gate unchanged

    @unit
    Scenario: Metrics still require the bearer when a key is set
      Given a metrics API key is configured
      When a caller requests "/metrics" without an Authorization header
      Then the response status is 401

    @unit
    Scenario: Metrics still fail closed in production without a key
      Given the worker is running in production mode
      And no metrics API key is configured
      When a caller requests "/metrics" with any credentials
      Then the response status is 500

    @unit
    Scenario: Metrics are served to a correctly authenticated caller
      Given a metrics API key is configured
      When a caller requests "/metrics" with the matching bearer token
      Then the response status is 200
      And the response body contains metric samples

  Rule: Unknown paths stay 404

    @unit
    Scenario: An unrelated path is not served
      When a caller requests "/not-a-real-path"
      Then the response status is 404

  Rule: The chart probes the liveness endpoint, not the metrics endpoint

    @e2e @unimplemented
    Scenario: Worker probes target /healthz with no credentials
      Given the Helm chart renders the workers Deployment
      Then the startup probe performs an HTTP GET on "/healthz"
      And the liveness probe performs an HTTP GET on "/healthz"
      And neither probe carries an Authorization header
      # No bearer token is copied into the podspec, so `get deploy` reveals
      # nothing a Secret was protecting.
