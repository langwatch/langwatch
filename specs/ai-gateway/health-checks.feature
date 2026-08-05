Feature: Gateway health checks

  # All scenarios in this file describe gateway HTTP probe endpoints
  # (/healthz, /readyz, /startupz) implemented in the Go gateway
  # service. Out of scope for the TS parity check — verified via Go
  # tests in services/aigateway/.
  #
  # The public status-page endpoint (GET /health) is a separate surface
  # with different consequences, see gateway-health.feature.

  Kubernetes uses three probe endpoints to distinguish transient
  dependency hiccups from a dead pod. Each has distinct semantics.

  Background:
    Given the Go gateway service is running at "http://gateway:5590"

  Rule: /healthz never lies about process liveness

    @unit @unimplemented
    Scenario: process alive returns 200 even when control plane is down
      Given the LangWatch control plane is unreachable
      When I GET "/healthz"
      Then the response status is 200
      And the response body contains "status":"ok"
      And no dependency check is invoked

    @integration @unimplemented
    Scenario: process deadlocked returns 503 within 2s
      Given the gateway main goroutine is deadlocked
      When I GET "/healthz" with a 2s timeout
      Then the probe times out
      And kubernetes will kill the pod

  Rule: /readyz gates traffic on pod state, never on dependencies

    # Deliberately dependency-free, two hard lessons deep. An
    # `auth_cache_warm` readiness check dead-locked cold starts: K8s
    # would not route traffic until /readyz went 200, but the cache
    # could only warm from routed traffic (see the note in
    # services/aigateway/deps.go). And a `control_plane_reachable`
    # readiness check would turn a control-plane blip into a total
    # gateway outage: every pod would drop from the load balancer at
    # once, killing exactly the warm-cache traffic the auth cache's
    # stale-while-error machinery is designed to keep serving.
    # Dependency health is reported on the public GET /health
    # status-page endpoint instead (gateway-health.feature), where a
    # red verdict informs a status page rather than gating traffic.

    @integration @unimplemented
    Scenario: readyz reflects only pod lifecycle
      Given the control plane is unreachable
      And the pod is not draining
      When I GET "/readyz"
      Then the response status is 200
      And warm-cache traffic keeps serving through the blip

    @integration @unimplemented
    Scenario: readyz is cheap (<50ms) and makes no upstream calls
      When I GET "/readyz" 10 times sequentially
      Then every response completes within 50ms
      And the cumulative upstream control-plane calls are 0

  Rule: /startupz blocks until initial warmup completes

    @unit @unimplemented
    Scenario: before first cache warm /startupz returns 503
      Given the gateway has been up for < 100ms
      And the cache bootstrap has not yet completed
      When I GET "/startupz"
      Then the response status is 503
      And the JSON body contains "status":"starting"

    @unit @unimplemented
    Scenario: after MarkStarted /startupz returns readiness
      Given the cache bootstrap has completed
      When I GET "/startupz"
      Then the response status is 200
      And the JSON body includes the readiness checks

    @integration @unimplemented
    Scenario: bootstrap-all-keys flag delays MarkStarted until full pull completes
      Given GATEWAY_CACHE_BOOTSTRAP_ALL_KEYS is true
      And the control plane has 2,500 active virtual keys
      When the gateway starts
      Then /startupz returns 503 until the bootstrap stream completes
      And /startupz returns 200 within 30 seconds of startup (with 2.5k keys)
      And the pod is then routed traffic

  Rule: Deployment rollouts respect probe semantics

    @integration @unimplemented
    Scenario: a faulty deploy never takes traffic
      Given a new gateway pod image has a broken config
      And config.Load fails on startup
      When kubernetes runs the pod
      Then the process exits with code 2
      And the readiness probe never turns green
      And the rollout is aborted by kubernetes with CrashLoopBackOff

    @integration @unimplemented
    Scenario: zero-downtime rolling update
      Given 3 gateway pods are serving traffic
      When kubernetes starts replacing pod 1 with a new version
      Then pod 1's /readyz returns 503 during SIGTERM grace period
      And pods 2 and 3 continue serving
      And no in-flight requests on pod 1 are dropped (60s shutdown timeout)
      And the new pod 1 only takes traffic after /startupz → 200
