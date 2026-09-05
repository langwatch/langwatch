Feature: Langy worker isolation
  As the operator of the langy-agent backend
  I want each conversation's worker isolated from its siblings
  So that a prompt-injected worker cannot read another conversation's live
     credentials or the content of someone else's conversation

  # Cross-references:
  #   ADR-033 — the original per-worker isolation model, written for the
  #             opencode harness and its unauthenticated control port.
  #   ADR-130 — per-worker identity isolation is the operator's choice; the
  #             shared-identity posture and what it does and does not trade.
  #   specs/langy/langy-deploy-hardening.feature — the chart-side guards.
  #   specs/langy/langy-pi-harness.feature — the harness this now describes.
  #
  # ---------------------------------------------------------------------------
  # What this feature used to say, and why it changed
  #
  # This spec was written when workers ran on the opencode harness. Opencode
  # exposed an HTTP control server on a loopback port with no authentication by
  # default, so any sibling in the same pod netns could drive another worker's
  # agent and make it exfiltrate its own credentials. The fix was a distinct
  # random OPENCODE_SERVER_PASSWORD per worker, turning isolation into a
  # property of authentication rather than of network topology — which also
  # made it survive gVisor, where netfilter does not exist.
  #
  # The opencode harness has been removed. Pi, the only harness now, has no
  # listener at all: a worker is driven over anonymous stdio pipes, so there is
  # no port, no path and no name for a sibling to reach. Holding the pipe IS the
  # authorization. The threat this file was written to close no longer has a
  # mechanism, and the password that closed it no longer exists.
  #
  # What remains is a narrower and more honest boundary, described below.
  #
  # On the @unimplemented tags. They mean "not bound to a test yet", and that is
  # true of every scenario here. They do NOT all mean "not built". Most of these
  # properties hold in the code today and are simply untested:
  #   - the pipe transport and the absence of any listener
  #     (adapters/pi/spawn.go:302-331, app/workerpool/pool.go:845)
  #   - the config carrying env var names rather than values
  #     (adapters/pi/spawn.go:26-29,119-121,213-214)
  #   - the per-identity refusals, enforced by the sandboxed runner
  #     (adapters/runner/sandboxed/sandboxed.go)
  # What is genuinely unbuilt is the shared-identity posture and the startup
  # announcement, both of which ADR-130 proposes. As tests land, the
  # @unimplemented tag comes off scenario by scenario; the level tag stays.
  # ---------------------------------------------------------------------------

  # ===========================================================================
  # The control channel: closed by construction, at any posture
  # ===========================================================================

  @unit @unimplemented
  Scenario: A worker has no control surface a sibling could address
    Given two workers are running for different conversations
    When one looks for the other's control channel
    Then there is no port, socket or path that names it
    And the only handles to it are held by the manager and by that worker itself
    # A pipe cannot be dialled. This holds regardless of which identity the
    # workers run under, so it is the one isolation property the operator's
    # posture choice cannot weaken.

  @unit @unimplemented
  Scenario: A worker cannot drive another worker's agent
    Given two workers are running for different conversations
    When one attempts to send a command intended for the other
    Then it has no channel on which to send it
    And the other worker's turn is unaffected

  # ===========================================================================
  # Credentials are never written to disk
  #
  # Load-bearing for the shared-identity posture in ADR-130: the reason that
  # posture is a defensible trade rather than a giveaway is that there is no
  # credential file to steal. A refactor that starts writing a resolved secret
  # into the worker's config would silently make the traded posture much worse,
  # and nothing else in this suite would notice.
  # ===========================================================================

  @unit @unimplemented
  Scenario: The worker's config names its secrets instead of carrying them
    Given a worker is provisioned for a conversation
    When its config is written
    Then every credential appears as the name of an environment variable
    And no resolved secret value appears anywhere in the file

  @unit @unimplemented
  Scenario: A worker's live credentials reach it only through its environment
    Given a worker is provisioned with a project key, a gateway key and a
      GitHub token
    When the worker starts
    Then those values are present in its environment
    And they are absent from every file the worker was provisioned with

  # ===========================================================================
  # The identity boundary: what the operator's posture actually governs
  #
  # With the control channel closed structurally and no secrets on disk, a
  # distinct per-worker identity is defending exactly two things: the worker's
  # process environment, and its conversation's session directory.
  # ===========================================================================

  @unit @unimplemented
  Scenario: Under per-worker identity, a worker cannot read a sibling's environment
    Given per-worker identity isolation is in effect
    And two workers are running for different conversations
    When one attempts to read the other's process environment
    Then the kernel refuses it

  @unit @unimplemented
  Scenario: Under per-worker identity, a worker cannot read a sibling's conversation
    Given per-worker identity isolation is in effect
    And two workers are running for different conversations
    When one attempts to read the other's session directory
    Then the kernel refuses it

  # Stated as a scenario rather than left implicit, because an operator who
  # selects this posture is entitled to a precise account of it, and because a
  # reader who finds only the two scenarios above would reasonably conclude the
  # product always refuses. See ADR-130 for the trade and the acknowledgement
  # the chart requires before it can be selected.
  @unit @unimplemented
  Scenario: Under shared identity, those two refusals do not hold
    Given the operator has turned per-worker identity isolation off
    And two workers are running for different conversations
    When one reads the other's process environment or session directory
    Then it succeeds
    And the control channel between them remains unreachable
    And nothing else about the worker's confinement has changed

  # ===========================================================================
  # Required connectivity is preserved
  #
  # Isolating a worker must not cut off what it legitimately needs. These are
  # the acceptance bar under either posture.
  # ===========================================================================

  @unit @unimplemented
  Scenario: An isolated worker can still reach the control plane and gateway
    Given a worker is running under per-worker identity isolation
    When the worker calls the LangWatch API or the AI gateway
    Then the call succeeds

  @unit @unimplemented
  Scenario: An isolated worker can still perform its GitHub and package work
    Given a worker is running under per-worker identity isolation
    And external egress is permitted for that worker
    When the worker runs git, gh, or a package install against an allowed host
    Then the operation succeeds

  # ===========================================================================
  # Posture is chosen, never drifted into
  # ===========================================================================

  @unit @unimplemented
  Scenario: Isolation is never silently downgraded at runtime
    Given per-worker identity isolation is in effect
    When isolation cannot be established for a new worker
    Then that worker is not started
    And the failure is surfaced rather than downgraded to a warning
    # The operator may choose the weaker posture deliberately, and the chart
    # makes them write that choice down. What must never happen is arriving
    # there because something failed and the manager carried on regardless.

  @unit @unimplemented
  Scenario: The manager announces which posture it started in
    Given the manager is starting
    When it resolves its isolation posture
    Then it records which one is in effect
    And a posture without per-worker identity is recorded as a warning
