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

  # Session resilience: the session must never strand the agent pointing at a
  # dead tunnel. Signals, crashes and tunnel failures all restore the previous
  # URL, and a health monitor watches the tunnel while the session runs.

  Scenario: A hangup signal restores the previous URL like an interrupt
    Given a dev tunnel session that repointed the agent
    When the terminal sends a hangup signal
    Then the agent URL is restored to the previous URL
    And the session exits cleanly

  Scenario: A crash inside the session restores best-effort and exits nonzero
    Given a dev tunnel session that repointed the agent
    When an unexpected error crashes the session
    Then the session tries to restore the previous URL
    And the session exits with a nonzero code

  Scenario: A second shutdown during restore does not restore twice
    Given a dev tunnel session whose restore is in flight
    When a second shutdown arrives
    Then the agent is restored exactly once
    And both shutdowns finish

  Scenario: A tunnel error ends the session like a tunnel exit
    Given a dev tunnel session that repointed the agent
    When the tunnel reports an error
    Then the agent URL is restored to the previous URL
    And the session ends with a nonzero code

  Scenario: An unhealthy tunnel is re-provisioned in place
    Given a dev tunnel session whose tunnel stops answering
    When the health check fails three times in a row
    Then a replacement tunnel is provisioned
    And the agent is pointed at the replacement tunnel URL

  Scenario: A probe that never answers does not stop the health monitor
    Given a dev tunnel session whose tunnel accepts the probe and never answers
    When the probe passes its own timeout
    Then the probe counts as a failure
    And the health monitor keeps running and provisions a replacement tunnel

  Scenario: A failed re-provision restores the agent and ends the session
    Given a dev tunnel session whose tunnel stops answering
    When provisioning a replacement tunnel fails
    Then the agent URL is restored to the previous URL
    And the session ends with a nonzero code

  Scenario: A bring-your-own tunnel only warns when unhealthy
    Given a dev tunnel session running over a caller-supplied tunnel URL
    When the health check fails three times in a row
    Then the session warns that the tunnel stopped answering
    And no replacement tunnel is provisioned

  Scenario: A bring-your-own tunnel session stays up instead of exiting at once
    Given a dev tunnel session running over a caller-supplied tunnel URL
    When the session has repointed the agent and printed its banner
    Then the command keeps running until a signal ends it
    And the agent URL is restored to the previous URL when it does

  Scenario: A stale stash from a crashed session is restored before a new tunnel
    Given an agent still carrying a dead tunnel URL from a crashed session
    When a new dev tunnel session starts
    Then the agent is first restored to the original URL
    And only then pointed at the fresh tunnel

  Scenario: Healthy checks refresh the tunnel heartbeat
    Given a dev tunnel session that repointed the agent
    When a health check finds the tunnel healthy
    Then the tunnel marker's heartbeat time is refreshed

  # `--agent` is optional: the session reuses the agent remembered for the
  # directory, auto-picks a lone HTTP agent, and offers an interactive picker
  # over several. The scenarios below pin the edges of that selection.

  Scenario: With no HTTP agents, an interactive session creates one on the spot
    Given the project has no HTTP agents
    And the session runs in a terminal
    When the developer confirms the offered agent name
    Then the session registers a new HTTP agent pointing at the local server
    And the offered name defaults to the current directory's name
    And the new agent is the session's target

  Scenario: A local URL carrying credentials is refused
    Given a --url value with a username and password embedded in it
    When the session resolves the local server to expose
    Then the session fails and says to pass the URL without credentials

  Scenario: Declining the offered agent name ends the session with instructions
    Given the project has no HTTP agents
    And the session runs in a terminal
    When the developer cancels the name prompt
    Then the session fails and names the agent create command

  Scenario: With no HTTP agents and no terminal, the session names the create command
    Given the project has no HTTP agents
    And the session runs without a terminal
    Then the session fails and names the agent create command

  Scenario: With several HTTP agents and no terminal, the session names the agent flag
    Given the project has several HTTP agents and no --agent flag
    And the session runs without a terminal
    Then the session fails and says to pass --agent to skip the picker
