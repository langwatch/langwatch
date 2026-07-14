Feature: Prompt Fetch Policy
  As a developer using the SDK
  I want to retrieve prompts using different fetch policies
  So that I can balance between freshness, latency, and offline availability

  # E2E: Happy paths demonstrating SDK usage with real API

  @e2e
  Scenario: Default policy fetches from API when no local file exists
    Given a prompt exists on the server
    When I retrieve the prompt with default policy
    Then the system returns the server version

  @e2e
  Scenario: ALWAYS_FETCH returns server prompt
    Given a prompt exists on the server
    When I retrieve the prompt with ALWAYS_FETCH policy
    Then the system calls the API
    And the system returns the server version

  @e2e
  Scenario: MATERIALIZED_ONLY returns local prompt without API call
    Given a prompt exists locally via CLI sync
    When I retrieve the prompt with MATERIALIZED_ONLY policy
    Then the system returns the local version
    And the system does NOT call the API

  @e2e
  Scenario: CACHE_TTL refetches after expiration
    Given a prompt exists on the server
    And the cache TTL is set to a short duration
    When I retrieve the prompt twice with a delay exceeding TTL
    Then the system calls the API on both retrievals

  # Integration: Edge cases and error handling with MSW

  @integration
  Scenario: ALWAYS_FETCH falls back to local when API fails
    Given the API returns an error
    And a prompt exists locally
    When I retrieve the prompt with ALWAYS_FETCH policy
    Then the system returns the local version

  @integration
  Scenario: MATERIALIZED_ONLY throws when local file not found
    Given no local prompt file exists
    When I retrieve a prompt with MATERIALIZED_ONLY policy
    Then the system throws a "not found" error
    And the system does NOT call the API

  @integration
  Scenario: CACHE_TTL returns cached version before expiration
    Given a prompt was fetched and cached
    And the cache has not expired
    When I retrieve the prompt with CACHE_TTL policy
    Then the system returns the cached version
    And the system does NOT call the API

  @integration
  Scenario: CACHE_TTL falls back to local when API fails
    Given the API is down
    And a prompt exists locally
    When I retrieve the prompt with CACHE_TTL policy
    Then the system returns the local version

  @integration
  Scenario: Prompt not found anywhere throws error
    Given no local prompt file exists
    And the API returns 404
    When I retrieve the prompt
    Then the system throws a "not found" error

  # Unit: Pure logic / isolated class behavior

  @unit
  Scenario: CACHE_TTL caches versions independently
    Given "my-prompt" version "1" was cached
    When I request "my-prompt" version "2"
    Then it's a cache miss
