Feature: Evaluator misconfiguration is a skip, not a failure
  As a platform operator
  I want evaluator misconfiguration to be reported as a skipped evaluation rather than an error
  So that our error telemetry only carries real faults, and customers see a
  self-serve message telling them what to configure

  # A customer disabling a model provider, or configuring a monitor against a
  # provider they never enabled, is an expected state of the product — not a
  # fault of the platform. These surface as `EvaluatorConfigError`, a
  # `HandledError` classified `fault: "customer"`, and must be treated the same
  # way as the pre-execution config gates (monitor not found, Azure Safety
  # provider absent) that already emit "skipped": see
  # specs/evaluators/azure-safety-byok-gating.feature.
  #
  # Everything else — unhandled errors, and handled errors classified
  # `fault: "platform"` or `fault: "provider"` — keeps its existing behaviour:
  # status "error" and an error-level log, so genuine faults still page us.

  @unit
  Scenario: Monitor using a provider the project has disabled is skipped
    Given a monitor whose evaluator uses a model from the "openai" provider
    And the project has the "openai" model provider configured but not enabled
    When a trace is processed that matches the monitor
    Then the evaluation is reported with status "skipped"
    And the details say "Provider openai is not enabled"
    And no error-level log is emitted

  @unit
  Scenario: Monitor using a provider the project never configured is skipped
    Given a monitor whose evaluator uses a model from the "anthropic" provider
    And the project has no "anthropic" model provider configured
    When a trace is processed that matches the monitor
    Then the evaluation is reported with status "skipped"
    And the details say "Provider anthropic is not configured"
    And no error-level log is emitted

  @unit
  Scenario: Misconfiguration is logged at info with a stable code for alerting
    Given a monitor whose evaluator uses a model from a provider that is not enabled
    When a trace is processed that matches the monitor
    Then an info-level log is emitted carrying the error code "evaluator_config_error"
    And the log carries the tenant, evaluator, and trace identifiers
    # The stable `code` is the signal a customer-health rule keys off, so we
    # never have to pattern-match log message strings to find affected projects.

  @unit
  Scenario: Genuine evaluator faults are still reported as errors
    Given a monitor whose evaluator execution throws an unexpected error
    When a trace is processed that matches the monitor
    Then the evaluation is reported with status "error"
    And an error-level log is emitted

  # Production evidence (8 days of prod logs, ~80 events): oversized payloads
  # arrived as an opaque `413 {"message":"Request Too Long"}` execution error,
  # which reads as a platform fault but is entirely the customer's to fix by
  # sending less text. Retrying cannot help — the same body is resent.
  @unit
  Scenario: An oversized evaluator payload is skipped with an actionable message
    Given a monitor whose evaluator input exceeds the evaluator size limit
    When a trace is processed that matches the monitor
    Then the evaluation is reported with status "skipped"
    And the details tell the customer to shorten the input
    And no error-level log is emitted

  # Only customer-fault errors are downgraded. An evaluator service outage is
  # also a "handled" error, but it is classified as a platform fault:
  # downgrading it would hide an outage behind a benign skip and stop it
  # paging us.
  @unit
  Scenario: An evaluator service outage is reported as an error, not a skip
    Given the evaluator service is unreachable or times out
    When a trace is processed that matches the monitor
    Then the evaluation is reported with status "error"
    And an error-level log is emitted
