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
  # Flattening the thrown error chain into the one line that crosses the
  # process boundary
  # ============================================================================
  # The child process reports a single line on stdout and exits. That line is
  # the only description of the failure that survives, and the classifier below
  # sees nothing else, so whatever the flattening drops or garbles is lost.

  # Wrapping an error as `new Error(`[${name}] ${error}`, { cause: error })` is
  # the common shape — @langwatch/scenario does it around every agent call — and
  # it puts the cause's whole message inside the wrapper's own. Appending the
  # cause again is what doubled the sentence customers read, and on a deeper
  # chain it spends the length budget repeating the tail instead of reaching the
  # useful end of it.
  @unit
  Scenario: A cause already quoted by its wrapper is stated once
    Given a thrown error whose message already contains its cause's message
    When the error chain is flattened for the parent process
    Then the repeated text appears once

  # `cause` is not the only link. The AI SDK's retry error leaves `cause` unset
  # and keeps the failure that ended the run on `lastError`, with every attempt
  # in `errors`. Following `cause` alone stopped one link short of the only link
  # carrying the provider's status code and response body — exactly the text the
  # classifier needs — so a provider verdict reached it as a single bare word.
  @unit
  Scenario: The chain follows an SDK aggregate past its empty cause
    Given a thrown error whose real failure hangs off lastError rather than cause
    When the error chain is flattened for the parent process
    Then the flattened text includes the underlying provider failure

  @unit
  Scenario: A cyclic cause chain terminates
    Given a thrown error whose cause chain points back at itself
    When the error chain is flattened for the parent process
    Then each error in the cycle appears once

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

  # Our own model gateway failing to dispatch is neither a provider verdict nor
  # anything the customer can fix, and it is usually gone by the next attempt.
  # It went unclassified for as long as it existed, because the provider rule
  # only knew the gateway's OTHER error type ("provider_error"). A real 2026-08-17
  # incident therefore put this in front of customers, verbatim, as the whole
  # explanation of a failed run:
  #
  #   [UserSimulatorAgent] AI_RetryError: Failed after 3 attempts. Last error:
  #   gateway_unavailable: Failed after 3 attempts. Last error: gateway_unavailable
  #
  # Three faults in one line: our internal class names, a doubled sentence, and
  # no statement that the fault was ours or that retrying would work.
  @unit
  Scenario: A model-gateway failure is named as ours and retryable
    Given a scenario run failed because our model gateway could not dispatch the call
    When the failure is classified
    Then the handled error code is "scenario_model_gateway_unavailable"

  @unit
  Scenario: A model-gateway failure never shows internal names
    Given a scenario run failed because our model gateway could not dispatch the call
    When the failure is classified
    Then the message names no internal class, library or error code

  @unit
  Scenario: A model-gateway failure tells the customer it is our fault
    Given a scenario run failed because our model gateway could not dispatch the call
    When the failure is classified
    Then the message says the model gateway was unavailable
    And the hint says the fault is on our side and the run is worth repeating

  # A throttle is separated from a rejection because the action differs: wait or
  # raise a limit, rather than fix a key or a model name. These only became
  # visible to the classifier once the gateway stopped masking upstream errors
  # (see specs/ai-gateway/error-transparency.feature).
  @unit
  Scenario: A provider throttle is named separately from a rejection
    Given a scenario run failed with a provider error code for a throttle or exhausted quota
    When the failure is classified
    Then the handled error code is "scenario_model_rate_limited"
    And the message surfaces the provider's own message
    And the hint says to wait or raise the provider's limit

  @unit
  Scenario: Forwarded provider verdicts classify as provider errors
    Given a scenario run failed with a forwarded provider error code for an unknown model or invalid request
    When the failure is classified
    Then the handled error code is "scenario_model_provider_error"

  # The `ai` SDK's error class names are the vocabulary of a library the
  # customer never chose and cannot act on. Any failure we can name gets a rule;
  # what is left reads better as a plain sentence than as a dependency's
  # exception type.
  @unit
  Scenario: An unnamed SDK failure degrades to a plain sentence
    Given a scenario run failed with a raw error naming only an AI SDK error class
    When the failure is classified
    Then the handled error code is "scenario_infra_error"
    And the message does not name an AI SDK error class

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

  # A runner that can't boot — a module missing from the production bundle, a
  # native addon that won't load, an ESM/CJS mismatch — used to reach the user
  # as Node's raw loader dump: the interpreter's own source path, the stack
  # frames, and the absolute path of our bundle inside the container. When the
  # process that died is ours, the cause is our deployment rather than the
  # customer's scenario, so it gets a named code that says exactly that.
  @unit
  Scenario: A runner that fails to boot becomes a named runner-unavailable error
    Given a scenario run whose own child process died with Node's module-loader crash dump
    When the failure is classified
    Then the handled error code is "scenario_runner_unavailable"
    And the message does not contain a raw stack trace
    And the message does not name an internal file path
    And the hint says the fault is on our side

  # A Node crash dump says a Node process failed to load something, not WHICH
  # process. The HTTP adapter embeds the customer's response body verbatim, so
  # an agent that boots with its own missing dependency arrives looking
  # identical — frames, require stack and all. Only our own child carries the
  # runner's exit wrapper, and that is what separates the two. Claiming the
  # fault is ours would send them looking anywhere but their own code.
  @unit
  Scenario: A customer's own module error is not blamed on our runner
    Given an agent replied with its own module-loader crash and our runner exited cleanly
    When the failure is classified
    Then the handled error code is not "scenario_runner_unavailable"
    And the hint does not claim the fault is on our side

  # A path is only an internal when it is ours. Suppressing every path also
  # suppressed the adapter's HTTP envelope — status, URL, request id and the
  # agent's own error body — which is the most diagnostic thing a customer
  # gets, and none of it ours to hide.
  @unit
  Scenario: The agent's own failure text survives the internals guard
    Given a scenario run failed with an agent message naming a route or a path of its own
    When the failure is classified
    Then the message keeps the agent's own wording

  # Defence in depth for the generic bucket: even an unclassified crash must
  # never surface a stack frame, an interpreter source location, or a bundle
  # path — including the bundle-relative ones that carry no leading slash.
  # When nothing readable is left, the user gets a plain sentence that does not
  # claim to know when the run failed.
  @unit
  Scenario: An unclassified crash dump degrades to a plain sentence
    Given a scenario run failed with a raw error containing only stack frames and interpreter paths
    When the failure is classified
    Then the handled error code is "scenario_infra_error"
    And the message does not contain a raw stack trace
    And the message does not name an internal file path
    And the message does not claim the run failed before it started

  # A model pinned to the codex provider refused for the requesting feature
  # (issue #6634's coding-assistant-surfaces backstop, see
  # specs/model-providers/codex-account-provider.feature — "The server
  # refuses Codex outside the allowed surfaces") reaches the scenario runner
  # as a raw refusal message, not an infrastructure crash. It gets its own
  # code and hint rather than falling into the generic infra bucket, and
  # both refusal wordings the codex backstop emits classify to it — they
  # share one message, coupled at the source by
  # src/server/modelProviders/codexRefusalMessage.ts.
  @unit
  Scenario: A codex coding-assistant-surface refusal becomes a named, actionable error
    Given a scenario run failed with a raw error mentioning that a model "serves the coding-assistant surfaces only"
    When the failure is classified
    Then the handled error code is "scenario_model_not_allowed_for_surface"
    And the message does not contain a raw stack trace
    And the hint points at the project's model default settings

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
    Given a local development environment with a trusted certificate authority configured
    When the runner's TLS environment is resolved
    Then the runner inherits that trusted certificate authority
    And TLS verification stays enabled

  @unit
  Scenario: Local dev without a trusted CA relaxes TLS for the runner only
    Given a local development environment with no trusted certificate authority configured
    When the runner's TLS environment is resolved
    Then TLS verification is relaxed for the runner only

  @unit
  Scenario: A hosted deployment never relaxes TLS for the runner
    Given a hosted deployment with no trusted certificate authority configured
    When the runner's TLS environment is resolved
    Then TLS verification stays enabled
    And no certificate override is injected
