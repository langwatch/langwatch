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
  # The fix has two parts, both in-process per pod:
  #
  #   A. Single-flight: concurrent calls for the same projectId share one
  #      in-flight Promise. Resolves once; rejects once; everyone sees the
  #      same result. Eliminates the burst-amplification factor.
  #
  #   B. ARN cache: a successful resolution is memoized per projectId,
  #      keyed by the current image_uri from LANGWATCH_NLP_LAMBDA_CONFIG.
  #      TTL is short enough that a stale entry self-heals; the image_uri
  #      portion of the key invalidates the cache automatically on deploy
  #      (a new image_uri = a cache miss, which re-runs the update path).
  #      Failures are NOT cached — a TooManyRequestsException must not
  #      poison subsequent calls.

  Background:
    Given LANGWATCH_NLP_LAMBDA_CONFIG is set with image_uri "ecr/foo:v1"
    And the in-process ARN cache is empty

  @integration @unit
  Scenario: First call for a project hits AWS and populates the cache
    When getProjectLambdaArn("projectA") is called
    Then exactly one GetFunction call is issued for "langwatch_nlp-projectA"
    And the returned ARN is the function's FunctionArn
    And the cache holds an entry for ("projectA", "ecr/foo:v1")

  @integration @unit
  Scenario: Subsequent calls within TTL serve from cache with zero AWS calls
    Given getProjectLambdaArn("projectA") has just resolved successfully
    When getProjectLambdaArn("projectA") is called 50 more times
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
  Scenario: TTL expiry forces a re-resolution
    Given getProjectLambdaArn("projectA") resolved at T0
    When the wall-clock advances past the cache TTL
    And getProjectLambdaArn("projectA") is called
    Then a fresh GetFunction call is issued
    And the cache entry is replaced with the new resolution

  @integration @unit
  Scenario: Different projects do not share cache slots
    When getProjectLambdaArn("projectA") and getProjectLambdaArn("projectB") both resolve
    Then the cache holds two independent entries
    And neither project's resolution shortcuts the other's
