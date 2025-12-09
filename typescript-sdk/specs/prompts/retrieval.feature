@integration
Feature: Prompt Retrieval
  As a developer using the SDK
  I want to retrieve prompts using different strategies
  So that I can balance between freshness, latency, and offline availability

  Scenario: Default Behavior (Materialized First)
    Given the prompt "test-prompt" exists locally
    And the prompt "test-prompt" also exists on the server
    When I retrieve the prompt "test-prompt" with no options
    Then the system should return the local version
    And the system should NOT call the API

  Scenario: Materialized First - Fallback to Server
    Given the prompt "test-prompt" does NOT exist locally
    But the prompt "test-prompt" exists on the server
    When I retrieve the prompt "test-prompt" with fetchPolicy "MATERIALIZED_FIRST"
    Then the system should return the server version

  Scenario: Prompt Not Found Anywhere
    Given the prompt "ghost-prompt" does NOT exist locally
    And the prompt "ghost-prompt" does NOT exist on the server
    When I retrieve the prompt "ghost-prompt"
    Then the system should throw an error

  Scenario: Always Fetch - Happy Path
    Given the prompt "test-prompt" exists locally
    And the prompt "test-prompt" exists on the server
    When I retrieve the prompt "test-prompt" with fetchPolicy "ALWAYS_FETCH"
    Then the system should call the API first
    And the system should return the server version

  Scenario: Always Fetch - API Failure Fallback
    Given the API is down or returns an error
    But the prompt "test-prompt" exists locally
    When I retrieve the prompt "test-prompt" with fetchPolicy "ALWAYS_FETCH"
    Then the system should attempt to call the API
    But upon failure, the system should return the local version

  Scenario: Materialized Only
    Given the prompt "test-prompt" does NOT exist locally
    When I retrieve the prompt "test-prompt" with fetchPolicy "MATERIALIZED_ONLY"
    Then the system should NOT call the API
    And the system should throw an error indicating the prompt was not found locally

  Scenario: Cache TTL - First Fetch
    Given the cache is empty
    When I retrieve the prompt "test-prompt" with fetchPolicy "CACHE_TTL" and ttl 5 minutes
    Then the system should fetch from the API

  Scenario: Cache TTL - Hit
    Given a prompt "test-prompt" was fetched 4 minutes ago
    And the fetch policy is CACHE_TTL with 5 minutes
    When I retrieve the prompt "test-prompt"
    Then the system should return the cached version
    And the system should NOT call the API

  Scenario: Cache TTL - Expiration
    Given a prompt "test-prompt" was fetched 6 minutes ago
    And the fetch policy is CACHE_TTL with 5 minutes
    When I retrieve the prompt "test-prompt"
    Then the system should ignore the cache
    And the system should fetch from the API

  Scenario: Cache TTL - API Failure Fallback
    Given the API is down
    And a prompt "test-prompt" exists locally
    When I retrieve the prompt "test-prompt" with fetchPolicy "CACHE_TTL"
    Then the system should return the local version
