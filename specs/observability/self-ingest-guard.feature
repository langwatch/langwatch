Feature: A LangWatch process refuses to ingest its own telemetry
  As an operator running the api and worker processes
  I want a boot that would point a process's own exporter at its own ingest to
  be refused with a line naming the variables
  So that the deployment cannot enter a telemetry feedback loop that it will
  only notice as a runaway ingest backlog

  Background:
    With LANGWATCH_API_KEY set, a process wires the LangWatch SDK's exporter
    and ships its OWN operational telemetry to whatever LANGWATCH_ENDPOINT
    names. When that endpoint is the same deployment, the result is a loop
    rather than observability: every ingested span does real work — Redis,
    Postgres, ClickHouse — and that work emits more spans, which are ingested,
    which do more work. The symptom observed in production was a runaway
    recordSpan backlog.

    The platform process refused the variable outright. The api and worker
    processes accept it deliberately, because exporting to a DIFFERENT
    LangWatch install is a supported and useful shape, so the refusal narrowed
    from "a key is set" to "a key is set and the endpoint is us" — the only
    case the blanket rule was ever protecting.

    An endpoint is this deployment when it resolves onto an address the
    deployment already states: BASE_HOST, NEXTAUTH_URL, or the api process's
    own listener. Two hostnames under one worktree's haven stack
    (<service>.<slug>.langwatch.localhost) are one deployment, because a stack
    serves several service names from one process group. An UNSET endpoint is
    checked against the SDK's own default rather than skipped, because on the
    deployment that serves that default the absence IS the loop.

    A refusal names both variables, the endpoint's host, and the deployment
    variable it collided with. It never names the key's value: nothing in the
    decision needs it, only whether one was given.

    # Bindings: packages/config/src/__tests__/self-ingest-guard.unit.test.ts
    # Bindings: apps/api/src/platform/config/__tests__/api.config.unit.test.ts
    # Bindings: apps/worker/src/platform/config/__tests__/worker.config.unit.test.ts
    # Sender: packages/config/src/self-ingest-guard.ts
    # Callers: apps/api/src/platform/config/api.config.ts (refuseApiSelfIngest)
    # Callers: apps/worker/src/platform/config/worker.config.ts (refuseWorkerSelfIngest)

  @unit
  Scenario: A process pointed at its own ingest refuses to boot
    Given a process is given an observability API key
    And the telemetry endpoint resolves to an address this deployment answers on
    When the process parses its configuration
    Then it refuses to boot before anything is composed

  @unit
  Scenario: A process exporting to a different LangWatch install boots
    Given a process is given an observability API key
    And the telemetry endpoint names a different LangWatch deployment
    When the process parses its configuration
    Then it boots and keeps the endpoint it was given

  @unit
  Scenario: A process with no observability key boots whatever the endpoint says
    Given a process is given no observability API key
    And the telemetry endpoint resolves to this deployment
    When the process parses its configuration
    Then it boots, because no exporter is wired and there is nothing to loop

  @unit
  Scenario: The refusal names the variables and never the key
    Given a boot is refused for pointing a process at its own ingest
    Then the refusal names the key's variable, the endpoint's variable, and the
      deployment variable the endpoint collided with
    And the refusal does not contain the key's value
