Feature: Scenario infrastructure error surfacing and empty-response state
  As a LangWatch user running a simulation
  I want infrastructure failures shown as a clean, actionable error and an
  explicit "No response" state when the agent says nothing
  So that I can diagnose a failed run without reading a raw stack trace

  # Context: when a scenario run fails at the infrastructure level (the child
  # runner can't reach the platform, the local TLS cert isn't trusted, the model
  # provider rejects the request, a timeout), the drawer previously showed a raw
  # "Child process exited with code 1: ..." dump. These scenarios teach the
  # failure path to classify the raw error into a handled error (the herr /
  # HandledError wire model: a stable code + human message + actionable hint)
  # that the drawer renders cleanly.
  #
  # Out of scope (explicitly): the webhook-test 405 that dumps upstream HTML,
  # and anything under pkg/ssrf.

  # ============================================================================
  # Classifying the raw child-runner error into a handled error
  # ============================================================================

  @unit
  Scenario: A self-signed certificate failure becomes an untrusted-certificate error
    Given a scenario run failed with a raw error mentioning "self-signed certificate in certificate chain"
    When the failure is classified
    Then the handled error code is "scenario_untrusted_certificate"
    And the message does not contain a raw stack trace
    And the hint explains how to trust the local certificate authority

  @unit
  Scenario: A connection failure becomes an unreachable-endpoint error
    Given a scenario run failed with a raw error mentioning "ECONNREFUSED"
    When the failure is classified
    Then the handled error code is "scenario_platform_unreachable"

  @unit
  Scenario: A model-provider rejection becomes a model-provider error
    Given a scenario run failed with a raw error mentioning a provider "API key is invalid"
    When the failure is classified
    Then the handled error code is "scenario_model_provider_error"
    And the message surfaces the provider's own message

  @unit
  Scenario: A timeout becomes an execution-timeout error
    Given a scenario run failed with a raw error mentioning "Scenario execution timed out"
    When the failure is classified
    Then the handled error code is "scenario_execution_timeout"

  @unit
  Scenario: An unrecognised failure keeps its message under a generic infra code
    Given a scenario run failed with a raw error "Something unexpected happened"
    When the failure is classified
    Then the handled error code is "scenario_infra_error"
    And the message is "Something unexpected happened"

  @unit
  Scenario: The handled error round-trips through the results error field
    Given a classified scenario handled error
    When it is encoded into the run's error field and decoded again
    Then the decoded code, message, and hint match the original
    And decoding a plain non-envelope string returns nothing

  # ============================================================================
  # Rendering the handled error in the run drawer
  # ============================================================================

  @integration
  Scenario: The drawer renders the handled error, not a raw dump
    Given a finished run whose error field holds an encoded untrusted-certificate error
    When the run drawer results are rendered
    Then the human message is shown
    And the actionable hint is shown
    And no raw "Child process exited with code" text is shown

  # ============================================================================
  # No-response empty state
  # ============================================================================

  @unit
  Scenario: A finished run with no messages and no error shows "No response"
    Given a run that reached a terminal status
    And the run produced no conversation messages
    And the run has no infrastructure error
    When the drawer decides whether to show the no-response state
    Then the no-response state is shown

  @unit
  Scenario: A run that errored does not show "No response"
    Given a run that reached a terminal status
    And the run produced no conversation messages
    But the run has an infrastructure error
    When the drawer decides whether to show the no-response state
    Then the no-response state is not shown

  @unit
  Scenario: An in-flight run does not show "No response"
    Given a run that has not reached a terminal status
    And the run produced no conversation messages
    When the drawer decides whether to show the no-response state
    Then the no-response state is not shown

  # ============================================================================
  # Local-dev TLS propagation to the scenario runner
  # ============================================================================

  @unit
  Scenario: A trusted local CA is forwarded to the runner
    Given the app process has NODE_EXTRA_CA_CERTS pointing at a local CA
    When the runner's TLS environment is resolved
    Then NODE_EXTRA_CA_CERTS is forwarded to the runner
    And TLS verification is not disabled

  @unit
  Scenario: Local dev without a trusted CA relaxes TLS for the runner only
    Given IS_SAAS is false and NODE_ENV is not production
    And no NODE_EXTRA_CA_CERTS is present
    When the runner's TLS environment is resolved
    Then TLS verification is disabled for the runner

  @unit
  Scenario: A hosted deployment never relaxes TLS for the runner
    Given IS_SAAS is true
    And no NODE_EXTRA_CA_CERTS is present
    When the runner's TLS environment is resolved
    Then TLS verification is not disabled
    And no certificate override is injected
