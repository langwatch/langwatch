Feature: Gateway health checks
  Kubernetes uses three probe endpoints to distinguish transient
  dependency hiccups from a dead pod. Each has distinct semantics.

  Background:
    Given the Go gateway service is running at "http://gateway:5590"

  Rule: /healthz never lies about process liveness

    @unit
    Scenario: process alive returns 200 even when control plane is down
      Given the LangWatch control plane is unreachable
      When I GET "/healthz"
      Then the response status is 200
      And the response body contains "status":"ok"
      And no dependency check is invoked

    @integration
    Scenario: process deadlocked returns 503 within 2s
      Given the gateway main goroutine is deadlocked
      When I GET "/healthz" with a 2s timeout
      Then the probe times out
      And kubernetes will kill the pod

  Rule: /readyz gates traffic on real dependencies

    @integration
    Scenario: all dependencies healthy returns 200 with each check reported
      Given the control plane responds 200 to /api/health
      And the auth cache has observed at least one revision
      And redis (if configured) responds PONG
      When I GET "/readyz"
      Then the response status is 200
      And the response JSON has "checks.control_plane_reachable" == "ok"
      And the response JSON has "checks.auth_cache_warm" == "ok"

    @integration
    Scenario: control plane 5xx flips readyz to 503
      Given the control plane returns 503 to /api/health
      When I GET "/readyz"
      Then the response status is 503
      And the JSON body contains "checks.control_plane_reachable" with an error detail
      And kubernetes removes this pod from the service endpoints
      And the pod is NOT killed (liveness still passes)

    @integration
    Scenario: auth cache cold flips readyz to 503
      Given the gateway has just started and no resolve-key / changes poll has returned yet
      When I GET "/readyz"
      Then the response status is 503
      And the JSON body contains "checks.auth_cache_warm" with "auth cache has not observed any revision yet"

    @integration
    Scenario: readyz is cheap (<50ms) even when all dependencies are healthy
      When I GET "/readyz" 10 times sequentially
      Then every response completes within 50ms
      And the cumulative upstream control-plane calls are ≤ 10

  Rule: /startupz blocks until initial warmup completes

    @unit
    Scenario: before first cache warm /startupz returns 503
      Given the gateway has been up for < 100ms
      And the cache bootstrap has not yet completed
      When I GET "/startupz"
      Then the response status is 503
      And the JSON body contains "status":"starting"

    @unit
    Scenario: after MarkStarted /startupz returns readiness
      Given the cache bootstrap has completed
      When I GET "/startupz"
      Then the response status is 200
      And the JSON body includes the readiness checks

    @integration
    Scenario: bootstrap-all-keys flag delays MarkStarted until full pull completes
      Given GATEWAY_CACHE_BOOTSTRAP_ALL_KEYS is true
      And the control plane has 2,500 active virtual keys
      When the gateway starts
      Then /startupz returns 503 until the bootstrap stream completes
      And /startupz returns 200 within 30 seconds of startup (with 2.5k keys)
      And the pod is then routed traffic

  Rule: Deployment rollouts respect probe semantics

    @integration
    Scenario: a faulty deploy never takes traffic
      Given a new gateway pod image has a broken config
      And config.Load fails on startup
      When kubernetes runs the pod
      Then the process exits with code 2
      And the readiness probe never turns green
      And the rollout is aborted by kubernetes with CrashLoopBackOff

    @integration
    Scenario: zero-downtime rolling update
      Given 3 gateway pods are serving traffic
      When kubernetes starts replacing pod 1 with a new version
      Then pod 1's /readyz returns 503 during SIGTERM grace period
      And pods 2 and 3 continue serving
      And no in-flight requests on pod 1 are dropped (15s shutdown timeout)
      And the new pod 1 only takes traffic after /startupz → 200
