Feature: App CI starts its datastores beside the job and bounds every step that runs after a failure
  As a developer waiting on CI
  I want datastore containers to start while the job checks out and installs, and no cleanup to hold a runner
  So that a pull request's suites start sooner and a stuck teardown cannot hold a job for its whole timeout

  # A job's services: block makes the runner pull and health-wait every container
  # before the first step (about 22s on package-suites, 98s on e2e), and stop them
  # after the last step in a teardown no workflow can put a timeout on.

  @unit
  Scenario: The app CI jobs declare no services block
    Given a job in langwatch-app-ci.yml or e2e-ci.yml
    Then it declares no services: block

  @unit
  Scenario: Every datastore started in the background is waited for before a step reads it
    Given a job in langwatch-app-ci.yml or e2e-ci.yml that starts a container with docker run -d --name
    Then a later cmd/waitcontainers step names that container
    And no step that migrates or runs suites comes between the start and the first wait

  @unit
  Scenario: A container wait passes once every container is healthy
    Given containers started in the background with a health check
    When cmd/waitcontainers waits for them
    Then it passes as soon as each reports healthy

  @unit
  Scenario: A container that never becomes healthy fails the wait with its logs
    Given a container that is not healthy by the deadline
    When cmd/waitcontainers waits for it
    Then it fails naming the container and its last health status
    And it prints the background start log and the container's own logs

  @unit
  Scenario: A container that stops fails the wait at once
    Given a container that exits or dies before it is healthy
    When cmd/waitcontainers waits for it
    Then it fails at once naming the container and its state
    And it prints the container's own logs

  @unit
  Scenario: Every step that runs after a failure, and every container wait, has its own time limit
    Given a step in langwatch-app-ci.yml or e2e-ci.yml whose if: names always(), failure() or cancelled() (not !cancelled() alone), or that waits for containers
    Then it declares its own timeout-minutes
