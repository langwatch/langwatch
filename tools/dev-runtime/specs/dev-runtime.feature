Feature: The dev runtime runs the Node applications in one local process
  As a contributor running LangWatch locally
  I want one command to start the api and the worker together
  So that a local stack cannot serve pages while processing no jobs

  Scenario: The dev entry point starts the api and the worker
    Given a contributor starts the dev entry point
    When the process finishes booting
    Then the api and the worker are both running in that one process, through @langwatch/process's backend seam
    And it logs "backend ready" once both are listening

  Scenario: A backend file change reloads the backend in process
    Given the backend is running
    When a backend source file changes
    Then the backend reloads after the debounce without restarting the Node process

  Scenario: The dev runtime is not part of any deployed image
    Given a production image is built
    Then it contains no code from tools/dev-runtime
