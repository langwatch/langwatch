Feature: Parallel deployment — Go and Python share one container/lambda
  As a platform operator deploying the Go NLP engine alongside the legacy Python service
  I want both processes to live in one container with Go as the front door
  So that a single Lambda Function URL (or pod ingress) routes to both engines without infrastructure rewrites

  # _shared/contract.md §3 — single container, two processes, Go on :5562, uvicorn on :5561.
  # Lambda Web Adapter forwards all traffic to :5562. nlpgo handles /go/* in-process and
  # reverse-proxies everything else to the uvicorn child. NLPGO_BYPASS=1 is the emergency
  # lever that swaps :5562 to be uvicorn directly.

  Background:
    Given the docker image "langwatch_nlp.lambda" is built from Dockerfile.langwatch_nlp.lambda
    And the image bundles the nlpgo Go binary AND the Python uvicorn app

  # ============================================================================
  # Container / lambda lifecycle
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: container start launches nlpgo as the entrypoint, which spawns uvicorn as its child
    When the container starts with no special env vars
    Then nlpgo is the only process the Lambda Web Adapter knows about
    And nlpgo binds 0.0.0.0:5562
    And nlpgo spawns "python -m uvicorn ... --port 5561" as a child process
    And nlpgo waits for the child's "/healthz" endpoint to return 200 before reporting itself ready

  @integration @v1 @unimplemented
  Scenario: nlpgo /healthz reflects child uvicorn health
    When the container is fully started
    Then GET /healthz returns 200 with body { "nlpgo": "ok", "uvicorn": "ok" }
    When the uvicorn child process is killed (SIGKILL) externally
    Then GET /healthz returns 503 with body { "nlpgo": "ok", "uvicorn": "down" } within 2 seconds

  @integration @v1 @unimplemented
  Scenario: nlpgo crashing on uvicorn child death exits the container so the orchestrator restarts it
    When the uvicorn child process exits with a non-zero status
    Then nlpgo logs the child exit reason at level "error"
    And nlpgo exits with the same status code (so Lambda restarts the container; k8s liveness restart in pod)

  @integration @v1 @unimplemented
  Scenario: SIGTERM is propagated from nlpgo to uvicorn for graceful shutdown
    When the container receives SIGTERM
    Then nlpgo sends SIGTERM to its uvicorn child
    And nlpgo waits up to NLP_SHUTDOWN_GRACE_SECONDS (default 30) for in-flight requests to complete
    And nlpgo exits 0 after both processes are clean

  # ============================================================================
  # Path-prefix dispatch
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario Outline: requests under /go/* are handled in-process by nlpgo, not proxied
    When a request hits "<path>"
    Then nlpgo handles the request in-process
    And no proxy hop to :5561 is observed in logs

    Examples:
      | path                       |
      | /go/studio/execute_sync    |
      | /go/studio/execute         |
      | /go/proxy/v1/chat/completions |
      | /go/healthz                |

  @integration @v1 @unimplemented
  Scenario Outline: requests not under /go/* are reverse-proxied to uvicorn at :5561
    When a request hits "<path>"
    Then nlpgo reverse-proxies to "http://127.0.0.1:5561<path>"
    And response headers/body from uvicorn are forwarded byte-equivalent
    And the proxy hop adds < 5ms p99 latency overhead

    Examples:
      | path                              |
      | /studio/execute_sync              |
      | /studio/execute                   |
      | /proxy/v1/chat/completions        |
      | /topics/batch_clustering          |
      | /topics/incremental_clustering    |
      | /healthz                          |

  @integration @v1 @unimplemented
  Scenario: streaming responses from uvicorn pass through the reverse proxy without buffering
    Given the legacy /studio/execute (SSE) is running on uvicorn
    When the client GETs /studio/execute via the proxy
    Then SSE chunks reach the client within 100ms of uvicorn emitting them
    And the proxy does not collect the full body before flushing

  # ============================================================================
  # NLPGO_BYPASS — emergency lever
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: NLPGO_BYPASS=1 makes uvicorn the entrypoint at :5562 directly
    Given the container is started with NLPGO_BYPASS=1
    When the container is up
    Then nlpgo is NOT running
    And uvicorn is bound on 0.0.0.0:5562
    And requests to /go/studio/execute_sync hit a uvicorn handler that returns 404 (no /go/ route in Python)
    And requests to /studio/execute_sync hit the existing Python handler

  @integration @v1 @unimplemented
  Scenario: NLPGO_BYPASS toggles cleanly across container restarts (no migration step needed)
    Given the previous container started without NLPGO_BYPASS
    When the container is restarted with NLPGO_BYPASS=1
    Then the new container has uvicorn on :5562 and nlpgo absent
    And no state on disk needs to be cleaned up between modes

  # ============================================================================
  # Authentication boundary — Go path requires HMAC; Python path stays unsigned
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: legacy /studio/execute_sync requests pass through the proxy unchanged (today's behavior)
    When the TS app POSTs to /studio/execute_sync (legacy path)
    Then nlpgo's reverse proxy forwards the request as-is
    And uvicorn responds 200

  # ============================================================================
  # Provider-credential handling
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: /go/proxy/v1/* translates x-litellm-* headers into a domain.Credential
    Given a /go/proxy/v1/chat/completions request carrying x-litellm-* credential headers
    When nlpgo translates the request
    Then no x-litellm-* header is forwarded to a second hop (there is no second hop)
    And the dispatcher receives the equivalent domain.Credential value in-process

  # ============================================================================
  # Resource budget
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: nlpgo's resident memory at idle is < 50 MB
    Given the container has been idle for 60 seconds after warmup
    When the operator measures the nlpgo RSS
    Then the RSS is below 50 MB
    And uvicorn's RSS is unaffected by the addition (no shared-memory overhead)

  @integration @v1 @unimplemented
  Scenario: cold-start added latency from spawning uvicorn child is below the existing budget
    When a fresh Lambda invocation cold-starts the container
    Then the time from container start to "uvicorn child healthy" is below the today's-baseline + 500ms
    And subsequent requests are not blocked on the child during normal operation

  # ============================================================================
  # Helm + container packaging
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: the Helm chart for langwatch_nlp launches the same container with the same env scheme
    Given the chart in charts/langwatch/templates/langwatch_nlp/ is installed
    When the deployment rolls out
    Then the pod runs the langwatch_nlp.lambda image (same one as Lambda)
    And container spec exposes only :5562
    And readiness probe hits /healthz on :5562 and requires both nlpgo + uvicorn = ok

  @integration @v1 @unimplemented
  Scenario: terraform memory floor is respected — no bump needed for the Go binary
    Given Lambda function memory is 1024 MB (current setting)
    When nlpgo + uvicorn run together
    Then peak memory under representative workflow load remains below 900 MB
    And no memory-bump terraform change is required for this PR
