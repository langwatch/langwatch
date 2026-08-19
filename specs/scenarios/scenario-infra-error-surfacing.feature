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
  Scenario: A DNS resolution failure becomes an unreachable-endpoint error
    Given a scenario run failed with a raw error mentioning "getaddrinfo"
    When the failure is classified
    Then the handled error code is "scenario_platform_unreachable"

  @unit
  Scenario: A hostname that could not be resolved becomes an unreachable-endpoint error
    Given a scenario run failed with a raw error saying the hostname could not be resolved
    When the failure is classified
    Then the handled error code is "scenario_platform_unreachable"

  # Knowing the run could not reach the target is half the answer. Which
  # target it was is the other half, and it is the half a customer acts on.

  @unit
  Scenario: An unreachable target names itself in the customer-facing message
    Given a scenario run failed because an HTTP agent target could not be reached
    When the failure is classified
    Then the customer-facing message names the target host
    And it holds none of the raw resolver text

  @unit
  Scenario: An unreachable endpoint with no named target keeps the generic message
    Given a scenario run failed with a bare transport error naming no target
    When the failure is classified
    Then the customer-facing message is the generic unreachable sentence

  @unit
  Scenario: A DNS failure on an agent with a dev tunnel names the dead tunnel
    Given a target that still carries a devTunnel marker
    And the run failed with a raw error mentioning "getaddrinfo"
    When the failure results are built
    Then the handled error code is "agent_dev_tunnel_unreachable"

  # A run that failed before any judging reports results whose reasoning is
  # the raw failure itself, or nothing at all. Those results went to storage
  # unclassified, so the drawer rendered a Node stack as the reason. They are
  # now classified on the way in, the same as a bare error. Results a judge
  # actually wrote carry their own reasoning and are never rewritten.

  @unit
  Scenario: Caller-supplied results whose reasoning is the raw failure are classified before storage
    Given a finish-run command whose results carry a raw transport failure as both error and reasoning
    When the run is finished
    Then the stored reasoning is the customer-safe sentence, not the raw failure
    And the stored error is the encoded envelope with a stable code

  @unit
  Scenario: Caller-supplied results with an error and no reasoning are classified before storage
    Given a finish-run command whose results carry an error and no reasoning
    When the run is finished
    Then the stored reasoning is the customer-safe sentence for that error

  @unit
  Scenario: A cancelled run stores the inconclusive verdict, not a raw failure verdict
    Given a finish-run command with the cancelled status whose results carry a failure verdict and a raw error
    When the run is finished
    Then the stored verdict is inconclusive
    And the stored reasoning says the run was cancelled by the user

  @unit
  Scenario: Results a judge wrote are stored untouched
    Given a finish-run command whose results carry a judge verdict with its own reasoning
    When the run is finished
    Then the results are stored exactly as the caller supplied them

  @unit
  Scenario: Passing results are never reclassified
    Given a finish-run command whose results carry a success verdict
    When the run is finished
    Then the results are stored exactly as the caller supplied them

  @unit
  Scenario: A dead tunnel names itself without a devTunnel lookup
    Given a raw failure carrying the Cloudflare edge's HTTP 530 answer with its "error code: 1033" body
    When the failure is classified
    Then the handled error code is "agent_dev_tunnel_unreachable" with the restart hint
    And an HTTP 530 without the 1033 body stays out of the tunnel classification

  @unit
  Scenario: An SDK-recorded failure classifies the same as a processor-caught one
    Given a run failure the scenario SDK recorded itself as serialized error JSON
    When the run's error is resolved for display
    Then the same classification applies and a dead tunnel shows the named tunnel copy
    And an upstream's HTML error page never renders as the failure reason

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
