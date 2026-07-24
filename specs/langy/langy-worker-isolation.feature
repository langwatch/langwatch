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
  # subsystem, which is unavailable under gVisor (runtimeClassName: gvisor —
  # the required posture for this workload per langwatch-saas#620): gVisor's
  # Sentry does not implement iptables / nftables in ANY backend or network
  # mode. The rule cannot be installed, and the manager aborts startup.
  # Verified on dev EKS (ARM64) 2026-07-02; see langwatch-saas#620 for the
  # full capability matrix.
  #
  # Root cause (established 2026-07-07): the iptables rule was treating a
  # symptom. Opencode's HTTP control server has no authentication by default,
  # so any sibling that can reach a worker's loopback port can drive that
  # worker's opencode to run shell as it and exfiltrate its live credentials.
  # The port being reachable was never the vulnerability — the port being
  # unauthenticated was.
  #
  # This feature closes the hole by giving every worker's opencode a distinct,
  # random OPENCODE_SERVER_PASSWORD (HTTP Basic auth). The manager's
  # authenticated proxy knows the password and can reach the worker; a sibling
  # that never learns the password gets 401. Isolation becomes a property of
  # authentication rather than network topology, so it no longer depends on
  # netfilter and works unchanged under gVisor.
  # ---------------------------------------------------------------------------

  # ===========================================================================
  # Sibling isolation (the core security property — must hold under gVisor)
  # ===========================================================================

  Scenario: A worker cannot authenticate to a sibling worker's opencode port
    Given two workers A and B are running for different conversations
    And each worker's opencode is secured by its own random password
    When worker A attempts to connect to worker B's opencode port without B's password
    Then the request is rejected with 401 Unauthorized
    And worker A cannot read worker B's session or credentials

  Scenario: A worker can still reach its own opencode port
    Given a worker is running for a conversation
    When the manager's authenticated proxy forwards a request to that worker
    Then the request reaches the worker's opencode
    And the response is returned to the caller

  # ===========================================================================
  # Required connectivity is preserved
  #
  # Securing the worker's opencode port must NOT cut off the connectivity it
  # legitimately needs. These scenarios are the acceptance bar regardless of
  # mechanism — under the current password-based design the network topology
  # never changes, so they hold by construction.
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
