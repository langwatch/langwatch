@unit
Feature: Agent dev tunnel
  As a developer with a registered HTTP agent
  I want `langwatch agent dev` to expose my local agent server through a tunnel
  So that platform scenarios run against the code on my machine

  # `langwatch agent dev` (alias `langwatch agent tunnel`) starts a public
  # tunnel to a local server, points the registered HTTP agent at it for the
  # session, and restores the previous URL on exit. A per-session secret and a
  # local auth proxy keep the public tunnel URL from being an open relay.

  Scenario: URL write-back replaces the agent URL and stashes the previous one
    Given a registered HTTP agent pointing at a deployed URL
    When the dev tunnel session points the agent at the tunnel
    Then the agent URL is replaced with the tunnel URL
    And the previous URL is stashed on the agent so exit can restore it

  Scenario: URL write-back keeps the agent's request path on the tunnel URL
    Given a registered HTTP agent whose deployed URL has a request path
    When the dev tunnel session points the agent at the tunnel
    Then the tunnel URL carries the same request path
    And a previous URL without a path leaves the tunnel URL bare

  Scenario: A second session over a stale tunnel keeps the original previous URL
    Given an agent still carrying a dead tunnel URL from a crashed session
    When a new dev tunnel session points the agent at its tunnel
    Then the stashed previous URL stays the original deployed URL

  Scenario: Ending the session restores the agent and clears the tunnel marker
    Given a dev tunnel session that repointed the agent
    When the session ends
    Then the agent URL is restored to the previous URL
    And the tunnel marker is removed from the agent
    And ending an already-restored session changes nothing

  Scenario: The session secret header row is replaced, never duplicated
    Given an agent whose configuration already carries a session secret header
    When a new dev tunnel session writes its secret
    Then the agent has exactly one session secret header row with the new secret

  Scenario: Opting out of the URL update touches nothing
    Given a registered HTTP agent pointing at a deployed URL
    When a dev tunnel session runs with the URL update turned off
    Then the agent is not modified

  Scenario: Bringing your own tunnel URL skips tunnel provisioning
    Given a developer with their own tunnel already running
    When the dev tunnel session runs with that tunnel URL
    Then no tunnel is provisioned
    And the agent is pointed at the supplied tunnel URL

  Scenario: The auth proxy rejects requests without the session secret
    Given a dev tunnel session with its auth proxy running
    When a request arrives without the session secret header
    Then the request is rejected as unauthorized
    And a request carrying the session secret reaches the local agent

  Scenario: A transport failure on a tunneled agent is named a dead dev tunnel
    Given a scenario run targeting an HTTP agent that carries the tunnel marker
    When the run fails because the connection to the agent fails
    Then the failure is classified as a dead dev tunnel
    And the failure explains how to restart the session or restore the URL

  Scenario: A transport failure on a regular agent keeps its generic classification
    Given a scenario run targeting an HTTP agent without the tunnel marker
    When the run fails because the connection to the agent fails
    Then the failure keeps the unreachable-endpoint classification

  Scenario: A tunneled agent is marked in the simulations target selector
    Given an HTTP agent that carries the tunnel marker
    When I pick a target for a simulation
    Then that agent shows a local tunnel badge
    And agents without the marker show no badge
