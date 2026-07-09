Feature: Langy works on a self-hosted install
  As an operator self-hosting LangWatch
  I want Langy to reach the LangWatch API and the AI gateway from inside my cluster
  So that enabling the assistant does not fail on the first message

  # The control plane resolves two endpoints and hands them to the Langy worker
  # (LangyCredentialService). The worker is locked down: its NetworkPolicy denies
  # external HTTPS egress and permits only the app pod and the gateway pod. Any
  # endpoint that leaves the cluster is unreachable, so both must be in-cluster
  # Service addresses.

  Background:
    Given an operator installs the LangWatch chart
    And the operator enables the Langy agent

  Scenario: Langy reaches the LangWatch API without leaving the cluster
    When the chart renders the app deployment
    Then the app receives a LangWatch API address pointing at the in-cluster app service
    And that address is reachable under the Langy worker's network policy

  Scenario: Langy reaches the AI gateway without leaving the cluster
    Given the operator lets the chart manage the AI gateway
    When the chart renders the app deployment
    Then the app receives an internal gateway address pointing at the in-cluster gateway service
    And that address is reachable under the Langy worker's network policy

  Scenario: The public gateway address is never used for worker traffic
    Given the operator has published the gateway on a public hostname
    When the chart renders the app deployment
    Then the worker's gateway address remains the in-cluster one
    And the public hostname is still offered to CLI users

  # Regression guard. The gateway reuses the "base URL" name for the opposite
  # direction — it dials the control plane on it — so handing that value to the
  # worker would point the assistant at the app instead of the gateway.
  Scenario: The gateway's own call-back address is never mistaken for the gateway
    When the chart renders the app deployment
    Then the app is not given the gateway's call-back address as its gateway address

  Scenario: An operator running the gateway elsewhere supplies the address
    Given the operator runs the AI gateway outside this chart
    And the operator has not supplied an internal gateway address
    When the chart renders the app deployment
    Then no internal gateway address is invented for them

  Scenario: Operator-supplied addresses win
    Given the operator supplies their own internal gateway address
    And the operator supplies their own LangWatch API address
    When the chart renders the app deployment
    Then the app receives the operator's addresses unchanged
