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
  # On the @unimplemented tags. They mean "not bound to a test yet", and that is
  # true of every scenario here. The product implements the isolated and
  # shared-identity postures, including the startup warning for shared identity.
  # These requirements remain unbound until tests bind them. As tests land, the
  # @unimplemented tag comes off scenario by scenario; the level tag stays.

  # ===========================================================================
  # One conversation cannot control another
  # ===========================================================================

  @unit @unimplemented
  Scenario: A worker cannot observe or control another conversation
    Given two workers are running for different conversations
    When one tries to observe or send commands to the other conversation
    Then it cannot observe or send those commands
    And the other conversation is unaffected

  # ===========================================================================
  # The isolation posture governs credentials and conversation content
  # ===========================================================================

  @unit
  Scenario: A worker receives live credentials without persisting them
    Given a worker is provisioned with credentials for its conversation
    When the worker receives those credentials for its conversation
    Then no resolved credential value is present in its provisioned files

  @unit
  Scenario: Provisioned files do not expose live credentials
    Given a worker is provisioned for a conversation
    When its provisioned files are inspected
    Then they identify the credentials the worker needs without containing their values

  @unit @unimplemented
  Scenario: Under per-worker identity, a worker cannot obtain a sibling's credentials
    Given per-worker identity isolation is in effect
    And two workers are running for different conversations
    When one attempts to obtain the other's live credentials
    Then access is refused

  @unit @unimplemented
  Scenario: Under per-worker identity, a worker cannot read a sibling's conversation
    Given per-worker identity isolation is in effect
    And two workers are running for different conversations
    When one attempts to obtain the other's conversation content
    Then access is refused

  # Stated as a scenario rather than left implicit, because an operator who
  # selects this posture is entitled to a precise account of it, and because a
  # reader who finds only the two scenarios above would reasonably conclude the
  # product always refuses. See ADR-130 for the trade and the acknowledgement
  # the chart requires before it can be selected.
  @unit @unimplemented
  Scenario: Under shared identity, those two refusals do not hold
    Given the operator has turned per-worker identity isolation off
    And two workers are running for different conversations
    When one tries to obtain the other's live credentials or conversation content
    Then it succeeds
    And it can control the other conversation
    And the configured pod sandbox and egress restrictions still apply

  # ===========================================================================
  # Required connectivity is preserved
  #
  # Isolating a worker must not cut off what it legitimately needs. These are
  # the acceptance bar under either posture.
  # ===========================================================================

  @unit @unimplemented
  Scenario Outline: A worker can still reach the control plane and gateway under either posture
    Given a worker is running under the <posture> posture
    When the worker calls the LangWatch API or the AI gateway
    Then the call succeeds

    Examples:
      | posture |
      | per-worker identity |
      | shared identity     |

  @unit @unimplemented
  Scenario Outline: A worker can still perform its GitHub and package work under either posture
    Given a worker is running under the <posture> posture
    And external egress is permitted for that worker
    When the worker runs git, gh, or a package install against an allowed host
    Then the operation succeeds

    Examples:
      | posture |
      | per-worker identity |
      | shared identity     |

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
