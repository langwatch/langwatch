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
    And the operator supplies an internal gateway address
    When the chart renders the app deployment
    Then no chart-managed gateway address is invented for them

  Scenario: Operator-supplied addresses win
    Given the operator supplies their own internal gateway address
    And the operator supplies their own LangWatch API address
    When the chart renders the app deployment
    Then the app receives the operator's addresses unchanged

  # Resolving a gateway address and being permitted to reach it are separate
  # things: the worker's egress is denied by default. A hybrid install — where
  # the gateway is hosted elsewhere and reachable only over the public internet
  # — silently dropped every LLM call until the operator opened that egress.
  # These configurations now fail at install time instead of at first chat.

  Scenario: Enabling Langy without any gateway address is refused at install
    Given the operator runs the AI gateway outside this chart
    And the operator supplies no gateway address at all
    When the operator installs the chart
    Then the install is refused
    And the message tells them which address to supply

  Scenario: Enabling Langy against an unreachable public gateway is refused at install
    Given the operator runs the AI gateway outside this chart
    And the gateway is reachable only over the public internet
    And the operator has not opened the worker's egress to it
    When the operator installs the chart
    Then the install is refused
    And the message offers each way to make the gateway reachable

  Scenario Outline: Opening the worker's path to a hosted gateway allows the install
    Given the operator runs the AI gateway outside this chart
    And the operator <makes the gateway reachable>
    When the operator installs the chart
    Then the install succeeds

    Examples:
      | makes the gateway reachable                  |
      | allows the worker's public egress            |
      | pins an egress rule to the gateway's address |
      | points the worker at an in-cluster gateway   |

  Scenario: The guard never fires for operators who have not enabled Langy
    Given the operator has not enabled the Langy agent
    And the operator runs the AI gateway outside this chart
    When the operator installs the chart
    Then the install succeeds
