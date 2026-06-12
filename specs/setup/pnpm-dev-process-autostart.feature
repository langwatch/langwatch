Feature: pnpm dev auto-starts the bundled Go services
  As a developer running the LangWatch app locally
  I want "pnpm dev" to bring up the Go services it depends on (the AI gateway and the nlpgo engine)
  So that the full request path works from a single command without a second terminal

  # Behavior lives in langwatch/scripts/start.sh (the dev process orchestrator)
  # and langwatch/scripts/lib/go-service-autostart.sh (the start-or-skip decision
  # plus the nlpgo bind-port resolution). Both helpers are bound to
  # langwatch/scripts/__tests__/dev-autostart.unit.bats. The full multi-process
  # integration (vite, api, workers, gateway and nlpgo coming up together under
  # concurrently) is verified by running "pnpm dev" for real and is not unit-bound
  # here. Each bundled Go service shares the same start-or-skip contract; the
  # gateway and nlpgo only differ in how their port is resolved.

  @unit
  Scenario: A bundled service auto-starts when its runtime is available and its port is free
    Given the service's runtime is installed
    And nothing is listening on the service port
    When pnpm dev resolves the start plan
    Then the service is scheduled to start

  @unit
  Scenario: An already-running service is reused instead of started twice
    Given another process is already serving the service port
    When pnpm dev resolves the start plan
    Then the service is not started a second time

  @unit
  Scenario: A bundled service does not start when the developer opted out of auto-start
    Given the developer opted out of auto-starting the service
    When pnpm dev resolves the start plan
    Then the service is not started
    And no skip warning is printed

  @unit
  Scenario: A bundled service is not auto-started when its runtime is unavailable
    Given the service's runtime is not installed
    When pnpm dev resolves the start plan
    Then the service is not started
    And the developer is told to run it manually

  @unit
  Scenario: The NLP engine serves on the address the app calls
    Given the app is configured to call a local NLP address with an explicit port
    When pnpm dev resolves the start plan
    Then the NLP engine serves on that same port

  @unit
  Scenario: The NLP engine gets a port of its own when none is configured
    Given the app has no explicit local NLP port configured
    When pnpm dev resolves the start plan
    Then the NLP engine serves on a port derived from the app's own port
    And the app is pointed at that derived port
    # Covers both a missing NLP address and a local one without a port:
    # in either case the app and the engine must end up on the same port,
    # never with the app calling port 80 while the engine serves elsewhere.

  @unit
  Scenario: No local NLP engine starts when the app calls a remote NLP service
    Given the app is configured to call an NLP service on another host
    When pnpm dev resolves the start plan
    Then no local NLP engine is started
