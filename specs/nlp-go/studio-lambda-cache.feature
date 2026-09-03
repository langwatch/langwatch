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

  @unit
  Scenario: Studio stream payloads retain Lambda Web Adapter behavior
    Given a response stream begins with a JSON prelude and eight zero bytes
    Then Studio receives only the bytes after the prelude
    And a malformed JSON prelude keeps the legacy 200 status default
    And a stream with no separator completes without emitting buffered bytes
