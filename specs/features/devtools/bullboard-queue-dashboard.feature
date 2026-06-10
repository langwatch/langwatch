Feature: Bull Board queue dashboard
  As a developer working on LangWatch
  I want a Bull Board UI for visualizing and managing BullMQ job queues
  So that I can inspect queue state, retry failed jobs, and debug processing issues

  # Parity status: 1 of 5 scenarios bound to existing tests.
  # Remaining @unimplemented scenarios (#3458):
  #   2 NO_TEST: shipped behavior, no integration test yet
  #     - "bullboard server starts and connects to Redis"
  #     - "bullboard server fails gracefully without Redis"
  #   2 NO_TEST: e2e behavior, no automated test
  #     - "Bull Board UI loads via dev-scenarios"
  #     - "Bull Board displays configured BullMQ queues"

  # --- Server startup and Redis connection ---

  @integration @unimplemented
  Scenario: bullboard server starts and connects to Redis
    Given a running Redis instance
    When the bullboard server starts
    Then it listens on port 6380
    And it connects to the Redis instance using REDIS_URL

  @integration @unimplemented
  Scenario: bullboard server fails gracefully without Redis
    Given no Redis instance is available
    When the bullboard server attempts to start
    Then it exits with a non-zero status
    And the error message mentions Redis connection failure

  # --- Docker compose integration ---

  @unit
  Scenario: bullboard service is included in scenarios profile
    Given the compose.dev.yml configuration
    Then the bullboard service belongs to the "scenarios" profile
    And its volume mounts ./bullboard to /app
    And it exposes port 6380

  # --- UI accessibility (full system) ---

  @e2e @unimplemented
  Scenario: Bull Board UI loads via dev-scenarios
    Given all services from the scenarios profile are running
    When a developer navigates to http://localhost:6380
    Then the Bull Board UI loads successfully

  @e2e @unimplemented
  Scenario: Bull Board displays configured BullMQ queues
    Given all services from the scenarios profile are running
    And at least one BullMQ queue exists in Redis
    When a developer navigates to http://localhost:6380
    Then the UI displays the configured BullMQ queues
