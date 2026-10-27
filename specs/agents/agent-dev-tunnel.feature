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

  # The tunnel runs a `cloudflared` binary the CLI downloads on first use. The
  # CLI pins one reviewed release and its published SHA-256 digests, and
  # never runs a binary it has not matched against them.

  Scenario: The tunnel binary is checked against the pinned release on every run
    Given a cloudflared binary from the pinned release is already on disk
    When a dev tunnel session starts
    Then the binary is matched against the pinned digest before it runs
    And nothing is downloaded

  Scenario: A binary from another release is replaced with the pinned one
    Given a cloudflared binary from an earlier release is on disk
    When a dev tunnel session starts
    Then the old binary is removed
    And the pinned release is downloaded, verified and run

  Scenario: On macOS the release archive is verified before it is unpacked
    Given a macOS machine with no cloudflared binary on disk
    When a dev tunnel session starts
    Then the downloaded archive is matched against the pinned archive digest
    And only then is the binary unpacked
    And the unpacked binary is matched against the pinned binary digest

  Scenario: A download that does not match the pinned release is refused
    Given the downloaded cloudflared release does not match the pinned digest
    When a dev tunnel session starts
    Then the session fails and suggests bringing your own tunnel
    And no binary is left on disk

  Scenario: A platform with no pinned release refuses to run
    Given a platform the pinned release has no digest for
    When a dev tunnel session starts
    Then the session fails without downloading or running anything

  Scenario: A binary the developer chose themselves is never deleted
    Given CLOUDFLARED_BIN points at a cloudflared binary outside the pinned release
    When a dev tunnel session starts
    Then the session fails and says to unset CLOUDFLARED_BIN or bring your own tunnel
    And the developer's binary is left untouched

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
