Feature: Worker Startup Architecture
  As a platform operator
  I want workers to start from a single entry point
  So that workers never run in duplicate across deployments

  Background:
    Given the LangWatch platform with Redis configured
    And the worker entry point at workers.ts

  # Integration tests - verifying module boundaries and startup behavior
  @integration
  Scenario: startApp() does not initialize background workers
    Given the start.ts module
    When startApp() is called
    Then no in-process worker initialization occurs
    And the HTTP server starts successfully
    And worker metrics endpoint proxies to external worker process

  @integration
  Scenario: Workers start only via start:workers entry point
    Given the workers.ts entry point
    When the start:workers command executes
    Then all background workers initialize via worker.ts
    And the worker metrics server starts on port 2999
    And event sourcing is initialized with ClickHouse and Redis

  @integration
  Scenario: Production deployment with separate worker pods
    Given a Kubernetes deployment configuration
    When the main deployment runs start:app
    And a separate worker deployment runs start:workers
    Then only the worker deployment runs background workers
    And the main deployment only serves HTTP requests
    And no worker duplication occurs

  @integration
  Scenario: Production deployment with workers alongside app
    Given a single-pod deployment configuration
    When start.sh executes with Redis configured
    Then start:app and start:workers run concurrently via concurrently
    And workers start exactly once via start:workers
    And no in-process workers start via startApp()

  @integration
  Scenario: Local development worker startup
    Given a local development environment
    When pnpm dev starts the application
    Then workers start via docker profile or concurrent setup
    And no in-process worker initialization from the app server

  # Unit tests - pure logic and configuration validation
  @unit
  Scenario: Worker initialization logs startup events
    Given the worker.ts module
    When workers initialize
    Then a startup log entry is emitted with logger name "langwatch:workers"
    And each worker type logs its initialization status

  @unit
  Scenario: Worker logs include structured context
    Given a worker processing a job
    When logging occurs during job execution
    Then log entries include worker type as context
    And log entries include job ID when available
    And log entries use appropriate log levels (info, warn, error)

  @unit
  Scenario: Worker restart logs include restart count
    Given workers configured with max runtime
    When workers reach max runtime and restart
    Then the restart event is logged
    And the worker restart counter metric increments
    And the process exits cleanly for restart

  @unit
  Scenario: Worker graceful shutdown logs closing events
    Given running workers
    When a shutdown signal is received
    Then closing events are logged for each worker
    And workers close gracefully before process exit
    And any in-flight jobs complete or are returned to queue

  @unit
  Scenario: initializeBackgroundWorkers module removed from startApp
    Given the start.ts module
    When examining the imports
    Then initializeBackgroundWorkers is not imported
    And no reference to background/init.ts exists
