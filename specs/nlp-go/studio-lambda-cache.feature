Feature: getProjectLambdaArn — per-project ARN cache + single-flight
  As an operator running langwatch-workers under heavy per-tenant event load
  I want resolving a project's Lambda ARN to be cheap and burst-tolerant
  So that a single chatty tenant cannot exhaust the regional AWS Lambda API
  quota and stall every fold/reactor for other tenants on the same pod.

  # Background — why this exists
  #
  # invokeLambda() and nlpgoFetch() both resolve `langwatch_nlp-<projectId>`
  # to an ARN before dispatching a studio/SSE call. Resolution does:
  #   1. GetFunction (checkLambdaExists)
  #   2. Optionally CreateFunction / UpdateFunctionCode
  #   3. GetFunction again, in a 500ms poll loop, until State=Active
  #
  # When a single tenant emits a burst of N studio-bound events, the worker
  # pool runs N concurrent getProjectLambdaArn() calls, each making 2-N
  # GetFunction calls against the same function name. AWS Lambda's
  # control-plane quota is regional and shared across every pod in the
  # cluster. On 2026-05-11 at 11:46 AMS a single project's burst triggered
  # cluster-wide CallerRateLimitExceeded (HTTP 429), each retry burning
  # 4-12s of worker budget before failing, which stalled unrelated
  # event-sourcing fold groups (e.g. projectDailySdkUsage/<date>:other:)
  # because workers were saturated on retry sleeps.
  #
  # The fix has two layers:
  #
  #   A. ARN cache via TtlCache (Redis-backed, with per-pod memory
  #      fallback when Redis is unavailable): a successful resolution is
  #      memoized per projectId. The cached value carries the image_uri
  #      it was resolved under, so a deploy (which bumps image_uri)
  #      auto-invalidates: readers treat an image_uri mismatch as a miss
  #      and re-run the UpdateFunctionCode path. Redis-backed means the
  #      first miss anywhere in the fleet warms every other pod.
  #      Failures are NOT cached — a TooManyRequestsException must not
  #      poison subsequent calls cluster-wide.
  #
  #   B. In-process single-flight (per pod): concurrent misses for the
  #      same projectId share one in-flight Promise. The shared Redis
  #      cache is great after the first writer lands, but a cold burst
  #      on one pod can still race before that write completes; this
  #      closes that per-pod window.

  Background:
    Given LANGWATCH_NLP_LAMBDA_CONFIG is set with image_uri "ecr/foo:v1"
    And the in-process ARN cache is empty

  @integration @unit
  Scenario: First call hits AWS; subsequent calls within TTL serve from cache with zero AWS calls
    When getProjectLambdaArn("projectA") is called
    Then a Lambda resolution flow runs against AWS
    And the returned ARN is the function's FunctionArn
    When getProjectLambdaArn("projectA") is called 50 more times within the TTL
    Then no additional Lambda SDK calls are issued
    And every call returns the same ARN

  @integration @unit
  Scenario: Concurrent burst for one project collapses into a single AWS resolution
    Given the cache is empty for "projectA"
    When getProjectLambdaArn("projectA") is invoked 100 times concurrently
    Then exactly one Lambda resolution flow runs end-to-end
    And all 100 callers receive the same ARN
    And no caller waits longer than the single resolution would have taken

  @integration @unit
  Scenario: A failed resolution does not poison the cache
    Given the next GetFunction call will throw TooManyRequestsException
    When getProjectLambdaArn("projectA") is called and rejects
    And the next GetFunction call succeeds
    And getProjectLambdaArn("projectA") is called again
    Then the second call resolves to a valid ARN
    And no stale failure result is returned from the cache

  @integration @unit
  Scenario: Deploy bumps image_uri and the cache invalidates automatically
    Given getProjectLambdaArn("projectA") resolved under image_uri "ecr/foo:v1"
    When LANGWATCH_NLP_LAMBDA_CONFIG is replaced with image_uri "ecr/foo:v2"
    And getProjectLambdaArn("projectA") is called
    Then a fresh Lambda resolution flow runs (cache miss on image_uri key)
    And the v1 cache entry is no longer used for future calls under v2

  @integration @unit
  Scenario: Different projects do not share cache slots
    When getProjectLambdaArn("projectA") and getProjectLambdaArn("projectB") both resolve
    Then the cache holds two independent entries
    And neither project's resolution shortcuts the other's
