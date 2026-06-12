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
  Scenario: A bundled Go service auto-starts when Go is present and its port is free
    Given the Go toolchain is on PATH
    And nothing is listening on the service port
    When pnpm dev resolves the start plan
    Then the service is scheduled to start

  @unit
  Scenario: A bundled Go service is reused when its port is already serving
    Given another process is already listening on the service port
    When pnpm dev resolves the start plan
    Then the service is not started a second time

  @unit
  Scenario: A bundled Go service is skipped when its skip flag is set
    Given the developer set the service's skip flag
    When pnpm dev resolves the start plan
    Then the service is not started
    And no skip warning is printed

  @unit
  Scenario: A bundled Go service is skipped when the Go toolchain is absent
    Given Go is not on PATH
    When pnpm dev resolves the start plan
    Then the service is not started
    And the developer is told to run it manually

  @unit
  Scenario: nlpgo binds to the localhost port the app is configured to call
    Given LANGWATCH_NLP_SERVICE points at a localhost port
    When pnpm dev resolves the nlpgo bind port
    Then nlpgo binds the same port the app will call

  @unit
  Scenario: nlpgo binds to the derived app-port-plus-one when no NLP service URL is configured
    Given LANGWATCH_NLP_SERVICE is unset
    When pnpm dev resolves the nlpgo bind port
    Then nlpgo binds the app port plus one

  @unit
  Scenario: nlpgo local auto-start is skipped when the NLP service URL is remote
    Given LANGWATCH_NLP_SERVICE points at a remote host
    When pnpm dev resolves the nlpgo bind port
    Then no local nlpgo is started
