@unimplemented
Feature: The langy-agent manager follows the house service conventions
  As an operator of the langy-agent backend
  I want the Go manager to match the platform's other Go services
  So that it is observable, has consistent errors and health, and its
     ADR-033 worker-isolation guarantees survive the re-home

  # Part of ADR-043 (Langy Foundations, PR1 of 4). The manager was a flat
  # `langyagent` package with hand-rolled config, sentinel errors, a plain
  # net/http mux, and zero OpenTelemetry. This feature is the observable
  # contract after it is re-homed onto the pkg/ toolkit (herr, config, clog,
  # otelsetup, lifecycle, health, httpmiddleware) behind a hexagonal layout
  # (domain / app / adapters/httpapi / adapters/workerpool / adapters/egress).
  #
  # The behaviour of /chat (ndjson stream), at-capacity, and conversation-busy
  # is UNCHANGED — this feature pins the conventions, not new user behaviour.

  # ===========================================================================
  # Configuration
  # ===========================================================================

  Scenario: Configuration is loaded from the documented environment variables
    Given the manager starts
    Then it reads LANGY_INTERNAL_SECRET, LANGY_MAX_WORKERS, LANGY_WORKER_IDLE_MS,
      LANGY_READINESS_TIMEOUT_MS, PORT, SESSIONS_ROOT and OPENCODE_OTEL_PLUGIN_VERSION
    And no configured env var name changed from the previous release

  Scenario: A missing internal secret fails fast at startup
    Given LANGY_INTERNAL_SECRET is not set
    When the manager starts
    Then startup fails with a configuration error rather than serving traffic

  # ===========================================================================
  # Errors and health
  # ===========================================================================

  Scenario: Errors are returned as the standard JSON error envelope
    Given an unauthenticated request to /chat
    When the request is rejected
    Then the response is a standard herr error envelope, not an ad-hoc map

  Scenario: The manager serves the standard health probes
    When the orchestrator probes the manager
    Then /healthz, /readyz and /startupz report liveness, readiness and startup
    And /health remains as a back-compat alias for the control-plane preflight

  Scenario: A conversation with a turn already in flight is rejected as busy
    Given a worker for a conversation is already streaming a turn
    When a second turn arrives for the same conversation
    Then the manager responds conversation-busy
    And the first turn is unaffected

  Scenario: At capacity the manager reports at-capacity on the stream
    Given the manager already holds LANGY_MAX_WORKERS workers
    When a new conversation requests a worker
    Then the stream carries an at-capacity error event

  # ===========================================================================
  # Telemetry (the load-bearing seam PR3 depends on)
  # ===========================================================================

  Scenario: The manager emits operational telemetry
    When the manager spawns a worker, kills a worker, hits capacity, or runs a turn
    Then it records spans and metrics for spawn, kill, at-capacity, readiness and per-turn latency
    And the telemetry flows through the same OpenTelemetry pipeline as the other Go services

  Scenario: An egress seam exists for later monitoring
    Given the worker pool is wired with an egress guard
    Then the default guard is a pass-through that changes no behaviour
    And it can be replaced without restructuring the pool

  # ===========================================================================
  # Context propagation
  # ===========================================================================

  Scenario: The caller's context propagates through the spawn path
    Given a request to spawn a worker
    When the manager spawns the opencode subprocess
    Then the subprocess is bound to the pool lifetime context, not a detached background context
    And a pool shutdown cancels the subprocess
    But an individual chat turn ending does not kill the long-lived worker

  # ===========================================================================
  # Isolation guarantees survive the re-home (ADR-033)
  # ===========================================================================

  Scenario: The re-home preserves the ADR-033 isolation guarantees
    Given the worker pool is the driven adapter that owns worker lifecycle
    Then per-worker UID allocation, the 0700 chown-before-secrets home,
      the per-worker OPENCODE_SERVER_PASSWORD, the authProxy bearer-to-Basic swap,
      the sensitive-env denylist, the process-group kill, the orphan reaper,
      and the fail-closed opencode auth guard all still hold
    And the workerpool package's tests prove each guarantee
