Feature: Per-project NLP Lambda resolution
  The process-owned NLP Lambda runtime resolves the Studio and nlpgo target.
  It shares successful ARN resolutions across API and worker instances while
  retaining an in-process single-flight for a cold burst.

  Background:
    Given the runtime has a deployment image and an injected ARN cache

  @unit
  Scenario: A successful resolution is shared for ten minutes
    When the runtime resolves "projectA" from AWS
    Then it stores the ARN and deployment image at "lambda_arn:projectA"
    And the shared entry has a TTL of 600 seconds
    And repeated local resolutions do not call AWS
    And a fresh runtime instance returns the shared ARN without calling AWS

  @unit
  Scenario: A concurrent local miss has one AWS resolution
    Given "projectA" has no cached ARN
    When the runtime resolves "projectA" concurrently
    Then all callers receive the same ARN
    And one AWS resolution flow runs

  @unit
  Scenario: Cache failures and malformed entries fall back to AWS
    Given the cache read fails or its entry is malformed
    When the runtime resolves "projectA"
    Then it resolves the ARN from AWS
    And a failed AWS resolution is not cached

  @unit
  Scenario: An image change deletes a stale cached ARN before refresh
    Given "projectA" has an ARN cached for image "ecr/foo:v1"
    When a runtime configured for image "ecr/foo:v2" resolves "projectA"
    Then it deletes the stale "lambda_arn:projectA" entry
    And it stores the refreshed ARN with image "ecr/foo:v2"

<<<<<<< HEAD
  @unit
  Scenario: Studio stream payloads retain Lambda Web Adapter behavior
    Given a response stream begins with a JSON prelude and eight zero bytes
    Then Studio receives only the bytes after the prelude
    And a malformed JSON prelude keeps the legacy 200 status default
    And a stream with no separator completes without emitting buffered bytes
=======
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
>>>>>>> origin/main
