Feature: getProjectLambdaArn — per-project ARN cache + single-flight
  As an operator running langwatch-workers under heavy per-tenant event load
  I want resolving a project's Lambda ARN to be cheap and burst-tolerant
  So that a single chatty tenant cannot exhaust the regional AWS Lambda API
  quota and stall every fold/subscriber for other tenants on the same pod.

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
  # event-sourcing fold groups (e.g. traceSummary/<date>:other:)
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
  Scenario: A config-only rollout (timeout change, no new image) invalidates the cache and reconciles
    Given getProjectLambdaArn("projectA") resolved under image_uri "ecr/foo:v1" with a 120s timeout
    When NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS is raised and image_uri is left unchanged
    And getProjectLambdaArn("projectA") is called
    Then the cached entry's configFingerprint no longer matches the desired configuration
    And a fresh Lambda resolution flow runs so reconcileProjectLambdaConfig applies the new timeout
    And the stale ceiling is not served for the remainder of the cache TTL

  @integration @unit
  Scenario: An unchanged desired configuration keeps serving from cache, no spurious invalidation
    Given getProjectLambdaArn("projectA") resolved and cached
    When getProjectLambdaArn("projectA") is called again with an identical desired configuration
    Then the configFingerprint matches and the cached ARN is returned
    And no additional AWS calls are made

  @integration @unit
  Scenario: Different projects do not share cache slots
    When getProjectLambdaArn("projectA") and getProjectLambdaArn("projectB") both resolve
    Then the cache holds two independent entries
    And neither project's resolution shortcuts the other's

  # Config reconcile — after resolveProjectLambdaArn finds an existing Lambda,
  # it compares the desired env vars / MemorySize (the same source
  # createProjectLambda uses) against the live FunctionConfiguration and
  # pushes only what has drifted, via UpdateFunctionConfigurationCommand.
  # This is what brings pre-existing (already-created) Lambdas up to date
  # with config the create path has since gained — the same "MemorySize
  # migration" gap that used to only be gestured at in a comment.

  @integration @unit
  Scenario: A pre-existing Lambda carrying a stale env var is reconciled without clobbering unmanaged vars
    Given a Lambda function exists whose CACHE_BUCKET env var is stale
    And the function also carries an env var this code does not manage
    When getProjectLambdaArn resolves that project
    Then exactly one UpdateFunctionConfiguration call is issued
    And the call's env vars match the desired set
    And the unmanaged env var is preserved unchanged

  @integration @unit
  Scenario: A Lambda still on the old 1024 MB default is raised to 2048
    Given a Lambda function exists with MemorySize 1024
    When getProjectLambdaArn resolves that project
    Then an UpdateFunctionConfiguration call sets MemorySize to 2048

  @integration @unit
  Scenario: No drift means no AWS write at all — the common path
    Given a Lambda function exists whose env vars and MemorySize already match the desired config
    When getProjectLambdaArn resolves that project
    Then no UpdateFunctionConfiguration call is issued

  @integration @unit
  Scenario: The code update lands and is polled to completion before the config update is sent
    Given a Lambda function exists with a stale image URI and a drifted MemorySize
    When getProjectLambdaArn resolves that project
    Then UpdateFunctionCode is called and polled to completion
    And only then is UpdateFunctionConfiguration called

  @integration @unit
  Scenario: A concurrent update makes AWS reject the reconcile but resolution still succeeds
    Given a Lambda function exists with a drifted MemorySize
    And AWS rejects the UpdateFunctionConfiguration call with "An update is in progress"
    When getProjectLambdaArn resolves that project
    Then the resolution still succeeds and returns a valid ARN

  @integration @unit
  Scenario: AWS errors are matched by exception name, not message text
    Given the UpdateFunctionConfiguration call rejects with a ResourceConflictException by name
    When getProjectLambdaArn resolves that project
    Then the exception is recognized and resolution still succeeds
    Given the UpdateFunctionConfiguration call rejects with an "An update is in progress" message and no recognized name
    When getProjectLambdaArn resolves that project
    Then the message is recognized as a fallback and resolution still succeeds
    Given the UpdateFunctionConfiguration call rejects with an unrelated error
    When getProjectLambdaArn resolves that project
    Then the unrelated error is rethrown
