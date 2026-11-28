Feature: The evaluations service follows the shared outbound policy on the chart
  As someone running LangWatch on my own cluster,
  I want the evaluations service to read the same outbound policy as the NLP
  service and the gateway,
  so that LLM evaluators only reach the model hosts I mean them to.

  # Cross-references:
  #   charts/langwatch/templates/langevals/deployment.yaml — where it is emitted.
  #   charts/langwatch/tests/langevals-egress.sh — renders the chart and asserts
  #     what reaches the pod.
  #   services/langevals/langevals_core/langevals_core/egress.py — what reads it.

  @e2e
  Scenario: the evaluations service refuses local addresses by default
    Given the chart's default values
    When the evaluations Deployment is rendered
    Then BLOCK_LOCAL_HTTP_CALLS is "true"
    And no ALLOWED_PROXY_HOSTS is set

  @e2e
  Scenario: the evaluations service reaches the hosts an operator allow-lists
    Given langevals.security.blockLocalHTTPCalls is false and two hosts are allow-listed
    When the evaluations Deployment is rendered
    Then BLOCK_LOCAL_HTTP_CALLS is "false"
    And ALLOWED_PROXY_HOSTS names both hosts

  @e2e
  Scenario: an operator's extraEnvs entry for the outbound policy wins
    Given langevals.extraEnvs sets BLOCK_LOCAL_HTTP_CALLS
    When the evaluations Deployment is rendered
    Then the Deployment carries that one entry and no chart default beside it
