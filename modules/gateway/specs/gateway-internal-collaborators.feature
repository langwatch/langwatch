Feature: The installed gateway answers the data plane's callbacks through the collaborators it composed
  The Go data plane calls back into the control plane for a key's config, a guardrail verdict and
  a fresh Codex session. The gateway module builds each collaborator in its own composition, from
  its members and its peers' Api tokens, so an install that dropped one refuses nothing by name:
  the callback simply stops working. These scenarios hold each wire through the installed module.

  @unit
  Scenario: The installed gateway answers a config fetch from its config materialiser
    Given the gateway module installed with its members and peers
    And a virtual key whose config version token is "cfg-1"
    When the data plane fetches that key's config with If-None-Match "cfg-1"
    Then the gateway answers 304 from the config materialiser

  @unit
  Scenario: The installed gateway runs a guardrail's evaluator through the evaluation module
    Given the gateway module installed with its members and peers
    And a fail-closed request guardrail whose evaluator has an enabled guardrail monitor
    When the data plane posts a guardrail check naming that guardrail
    Then the evaluation module's runEvaluator runs the monitor's check
    And the evaluator's failing verdict blocks the request

  @unit
  Scenario: The installed gateway refreshes a Codex session through the model provider module
    Given the gateway module installed with its members and peers
    When the data plane asks for a fresh Codex session on a provider row
    Then the model provider module refreshes that row
    And the gateway answers with the session it returned
