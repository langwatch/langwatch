Feature: One platform health answer for an external monitor

  Better Stack and every other external monitor asks one question: is the
  platform working right now. The `/api/v1/platform-health` family answers it
  by running the subsystem probes this deployment already has and reporting
  what each one said.

  The family is gated by a static key the deployment configures, not by a
  project API key: a monitor is not a tenant, and the answer it reads carries
  no tenant data. A deployment that configured no key serves no routes at all,
  so nobody reaches a platform-wide probe by presenting nothing.

  @integration
  Scenario: A request with no key runs no probe
    Given a deployment that configured a platform health key
    When a monitor asks for the platform health without a key
    Then the answer is refused as unauthorized
    And no subsystem was probed

  @integration
  Scenario: A request with the wrong key runs no probe
    Given a deployment that configured a platform health key
    When a monitor asks for the platform health with a key that is not this deployment's
    Then the answer is refused as unauthorized
    And no subsystem was probed

  @unit
  Scenario: A key of a different length is refused without a byte-by-byte comparison
    When a key of a different length to the configured one is presented
    Then it is refused
    And the comparison that did happen was constant time

  @integration
  Scenario: Each subsystem is reachable on its own path
    Given a deployment that configured a platform health key
    When a monitor asks for one named subsystem
    Then only that subsystem is probed
    And the answer names it

  @integration
  Scenario: A subsystem this platform does not have is not found
    Given a deployment that configured a platform health key
    When a monitor asks for a subsystem name this platform does not have
    Then the answer says there is no such subsystem

  @integration
  Scenario: The aggregate runs every subsystem
    Given a deployment that configured a platform health key
    When a monitor asks for the platform health
    Then every subsystem is probed
    And the answer carries one entry per subsystem with how long it took

  @integration
  Scenario: A working platform answers success
    Given every subsystem answers
    When a monitor asks for the platform health
    Then the answer is a success
    And the overall status is healthy

  @integration
  Scenario: One broken subsystem makes the whole answer a failure
    Given one subsystem does not answer
    When a monitor asks for the platform health
    Then the answer is a service failure
    And the overall status is unhealthy

  @unit
  Scenario: A probe that throws is unhealthy and does not take the others down
    Given one subsystem probe throws
    When the platform health is checked
    Then that subsystem is reported unhealthy
    And every other subsystem is still reported

  @unit
  Scenario: A failure detail never carries the upstream's own words
    Given a subsystem refuses the probe with a message of its own
    When the platform health is checked
    Then the reported detail is our own words for what broke
    And it carries no upstream prose

  @unit
  Scenario: A subsystem this deployment never pointed anywhere is degraded, not broken
    Given a subsystem the deployment named no target for
    When the platform health is checked
    Then that subsystem is reported as not configured
    And the overall status is degraded rather than unhealthy

  @unit
  Scenario: A probe credential scoped to one project stays scoped downstream
    Given the probe credential resolves to exactly one project
    When a subsystem probe posts its canary back through the public boundary
    Then the canary names that project alongside the token

  @unit
  Scenario: A blank key is refused rather than read as unconfigured
    Given a deployment that exported the platform health key with no value
    When its configuration is validated
    Then the deployment is refused

  @integration
  Scenario: A deployment with no key serves no platform health routes
    Given a deployment that configured no platform health key
    When a monitor asks for the platform health
    Then there is no such route

  Rule: /api/health/* answers an orchestrator's project-keyed probe in main's words

    @integration
    Scenario: A project-keyed probe with no token is refused with main's sentence
      When an orchestrator asks /api/health/collector without X-Auth-Token or a Bearer token
      Then it answers 401 with {"message":"Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token."}

    @integration
    Scenario: A project-keyed probe with an unknown key is refused
      When an orchestrator asks /api/health/evaluations with a key that resolves to no project
      Then it answers 401 with {"message":"Invalid auth token."}

    @integration
    Scenario: A project-keyed probe accepts an API key as a Bearer token and forwards it
      Given an API key that resolves to a project
      When an orchestrator asks /api/health/evaluations with that key as a Bearer token
      Then the sample evaluation is sent with the same key and the project id
      And it answers 200 with the canary's status and body

    @integration
    Scenario: A project-keyed probe reports a missing trigger as main did
      When an orchestrator asks /api/health/triggers for a trigger the project does not have
      Then it answers 404 with {"message":"Trigger not found."}

  Rule: /api/health/scenarios launches one run of a named run plan and waits for its judge, as main did

    @unit
    Scenario: The scenario canary reports healthy when the judged run succeeds
      Given a run plan naming exactly one scenario and one target
      When the canary launches a run and it settles with a successful verdict
      Then the canary reports healthy with the run id and its duration

    @unit
    Scenario: The scenario canary retries once after an unhealthy first run
      Given the first canary run ends in an error
      When the retry settles with a successful verdict
      Then the canary reports healthy, having launched two runs

    @unit
    Scenario: The scenario canary reports judge_failed when a successful run carries no verdict
      When both canary runs succeed without a judge verdict
      Then the canary reports unhealthy with the reason judge_failed

    @unit
    Scenario: The scenario canary reports timeout when the run never settles
      When no canary run reaches a terminal status within its budget
      Then the canary reports unhealthy with the reason timeout

    @unit
    Scenario: A run plan that names more than one scenario launches nothing
      Given a run plan naming two scenarios
      When the canary is pointed at it
      Then it reports unhealthy with the reason run_failed and no run is launched

    @unit
    Scenario: The scenario canary finds a run plan by its slug
      When the canary is pointed at a run plan by its slug
      Then it launches that plan's scenario

    @unit
    Scenario: A second probe of the same run plan while one is in flight is told busy
      Given a canary run of a plan is in flight
      When the same plan is probed again by its other name
      Then the second probe is told busy and launches nothing

    @unit
    Scenario: The scenario canary answers main's bodies for a healthy run and a busy plan
      Then a healthy canary answers 200 {"status":"ok","scenarioRunId","durationMs"}
      And a busy plan answers 429 {"status":"busy"}

    @integration
    Scenario: The scenario canary refuses an unknown key without caching the answer
      When an orchestrator asks /api/health/scenarios with a key that resolves to no project
      Then it answers 401 with {"message":"Invalid auth token."} and Cache-Control no-store

    @integration
    Scenario: The scenario canary without a runPlanId is a bad request
      When an orchestrator asks /api/health/scenarios with a blank runPlanId
      Then it answers 400 with {"message":"runPlanId query parameter is required."}

    @integration
    Scenario: The scenario canary refuses an implausibly long runPlanId
      When an orchestrator asks /api/health/scenarios with a runPlanId longer than 128 characters
      Then it answers 400 with {"message":"runPlanId query parameter is invalid."}

    @integration
    Scenario: The scenario canary answers 503 with the named reason for a plan it cannot find
      When an orchestrator asks /api/health/scenarios for a run plan the project does not have
      Then it answers 503 with {"status":"unhealthy","reason":"run_failed","durationMs":0}, uncached

  Rule: /api/health/langy sends one greeting turn as the key's owner and waits for it to settle, as main did

    @unit
    Scenario: The Langy canary classifies a settled turn as main did
      Then a completed turn with text is healthy
      And a failed or stopped turn is turn_failed
      And a completed turn with only whitespace is empty_reply
      And a wait the budget ended is timeout

    @unit
    Scenario: The Langy canary answers main's bodies
      Then a healthy check answers 200 {"status":"ok","conversationId","turnId","durationMs"}
      And an unhealthy check answers 503 with its reason and the turn's ids
      And a busy caller answers 429 {"status":"busy"}

    @unit
    Scenario: The Langy canary sends the greeting as the key's owner with a fresh idempotency key
      When two checks run one after the other
      Then each starts one "Hi Langy." turn as the key's owner under a different idempotency key
      And a healthy answer is not cacheable

    @unit
    Scenario: The Langy canary answers a dark surface with a plain 404 and starts no turn
      Given the Langy turn surface is dark for the project
      When the canary is asked
      Then it answers the plain-text 404 an unmounted path gives, with no Cache-Control

    @unit
    Scenario: A Langy turn that does not settle inside the budget is timeout
      When the settlement wait outlasts the budget
      Then the canary reports unhealthy with the reason timeout and the turn's ids

    @unit
    Scenario: A Langy turn that cannot start is turn_failed
      When starting the turn throws
      Then the canary reports unhealthy with the reason turn_failed

    @unit
    Scenario: A second Langy check for the same caller while one is in flight is busy
      Given a Langy check is in flight for a caller
      When the same caller checks again
      Then the second check is busy and starts no turn, while another caller is not blocked

    @unit
    Scenario: A Langy timeout reserves the caller's slot for one further budget
      Given a Langy check timed out
      When the same caller checks again inside one budget
      Then it is busy, and once the budget has passed a check runs again
