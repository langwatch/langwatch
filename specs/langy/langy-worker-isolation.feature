@unimplemented
Feature: Langy worker network isolation under a sandboxed runtime
  As the operator of the langy-agent backend
  I want each conversation worker isolated on the network from its siblings
  So that a prompt-injected worker cannot reach another worker's opencode port
     and exfiltrate that worker's live API key / GitHub token

  # ---------------------------------------------------------------------------
  # Background: the threat this feature closes
  #
  # The manager runs many opencode workers inside ONE pod. Each worker holds a
  # different user's live credentials in its environment. Workers execute
  # LLM-generated shell, so worker A can be induced to attack worker B.
  #
  # Today, sibling isolation on the NETWORK is enforced by an iptables OUTPUT
  # OWNER-match DROP rule on the shared pod loopback (services/langy-agent/
  # iptables.go, from PR #4913). That rule requires the kernel netfilter
  # subsystem.
  #
  # When the pod runs under gVisor (runtimeClassName: gvisor — the required
  # posture for this workload per the reference chart and langwatch-saas#620),
  # netfilter is unavailable: gVisor's Sentry does not implement iptables /
  # nftables in ANY backend or network mode. The rule cannot be installed, and
  # the manager aborts startup. Verified on dev EKS (ARM64) 2026-07-02; see
  # langwatch-saas#620 for the full capability matrix.
  #
  # This feature replaces the netfilter-based network wall with per-worker
  # network namespaces, which gVisor DOES implement. Isolation is then a
  # property of the topology (a sibling has no route to reach the port at all)
  # rather than a filtering rule layered over a shared network.
  # ---------------------------------------------------------------------------

  # ===========================================================================
  # Sibling isolation (the core security property — must hold under gVisor)
  # ===========================================================================

  Scenario: A worker cannot reach a sibling worker's opencode port
    Given two workers A and B are running for different conversations
    And each worker's opencode listens on its own loopback port
    When worker A attempts to connect to worker B's opencode port
    Then the connection does not succeed
    And worker A cannot read worker B's session or credentials

  Scenario: A worker can still reach its own opencode port
    Given a worker is running for a conversation
    When the manager's authenticated proxy forwards a request to that worker
    Then the request reaches the worker's opencode
    And the response is returned to the caller

  # ===========================================================================
  # Required connectivity is preserved (the hard part of the design)
  #
  # Isolating the worker's network must NOT cut off the connectivity it
  # legitimately needs. These scenarios are the acceptance bar for whatever
  # connectivity mechanism the implementation chooses (veth pair, proxied
  # egress, etc.).
  # ===========================================================================

  Scenario: An isolated worker can still reach the control plane and gateway
    Given a worker is running under network isolation
    When the worker calls the LangWatch API or the AI gateway
    Then the call succeeds

  Scenario: An isolated worker can still perform its GitHub / package work
    Given a worker is running under network isolation
    And external egress is permitted for that worker
    When the worker runs git, gh, or a package install against an allowed host
    Then the operation succeeds

  # ===========================================================================
  # Runtime posture
  # ===========================================================================

  Scenario: The manager starts successfully under the sandboxed runtime
    Given the pod runs under the sandboxed runtime with per-worker isolation enabled
    When the manager starts
    Then it does not depend on kernel netfilter being available
    And it begins accepting traffic only after worker isolation is in effect

  Scenario: Sibling isolation is never silently disabled in production
    Given the production configuration
    When worker network isolation cannot be established for a new worker
    Then that worker is not started
    And the failure is surfaced rather than downgraded to a warning
