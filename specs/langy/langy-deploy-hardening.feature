Feature: Langy deploy hardening — sandboxed-runtime guard and e2e security parity
  As the operator of the langy-agent backend
  I want the chart to refuse an unsafe managed deploy, and the local e2e
    manifest to mirror the production security posture
  So that this LLM-driven-shell workload can never ship without its pod-to-host
    sandbox, and local testing exercises the same per-worker isolation as prod

  # Cross-references:
  #   ADR-033 — Langy worker network isolation under gVisor: the sandboxed
  #             runtime requirement and the per-worker UID isolation model.
  #   ADR-047 — Langy Foundations: the hardening batch this spec belongs to
  #             (authored alongside these changes).
  #
  # Why this matters. The langy-agent pod runs many opencode workers, each
  # holding a DIFFERENT user's live credentials and executing LLM-generated
  # shell — so a prompt-injected worker A can be induced to attack worker B.
  # Two invariants keep that safe:
  #   (1) the pod runs under a sandboxed runtime (gVisor/runsc) so a worker that
  #       breaks OUT of the container still cannot reach the node kernel;
  #   (2) the manager runs as root with a narrow capability set so it can hand
  #       each worker a DISTINCT UID (per-worker child_process spawn) — without
  #       which sibling workers share a UID and can read each other's project
  #       API key + GitHub token straight off disk.
  # The chart already fails the render when replicaCount != 1 or when
  # service.type != ClusterIP. The sandboxed-runtime guard below is the third
  # invariant in that same render-time-guard family.

  # ===========================================================================
  # Chart render-time guard: no managed deploy without a sandboxed runtime
  # ===========================================================================

  Scenario: The chart refuses to render when managed without a sandboxed runtime
    Given the chart manages the langy-agent pod
    And no sandboxed runtime is configured for the pod
    When an operator renders the chart to deploy it
    Then the deploy fails before producing any manifests
    And the failure names the missing sandboxed runtime
    And the failure explains that running this workload without a sandbox
      re-opens the pod-to-host escape surface
    # Same family as the existing replicaCount and service.type render guards.

  Scenario: The chart renders with the sandboxed runtime set
    Given the chart manages the langy-agent pod
    And the sandboxed runtime is set to "gvisor"
    When an operator renders the chart to deploy it
    Then the pod renders successfully
    And the pod is pinned to the sandboxed runtime

  Scenario: The guard does not fire when the agent is not chart-managed
    Given the chart does not manage the langy-agent pod
    And no sandboxed runtime is configured for the pod
    When an operator renders the chart
    Then rendering succeeds without requiring a sandboxed runtime
    # Opting the whole pod out is the only legitimate way to run without the
    # sandbox; blanking the runtime while still managed is not, and is refused.

  # ===========================================================================
  # Local e2e manifest mirrors the production security posture
  # ===========================================================================

  Scenario: The e2e manifest matches the production security posture
    Given the local end-to-end pod manifest for langy-agent
    When it is applied to a local cluster
    Then the manager runs as root
    And it keeps only the capabilities required to give each worker a distinct
      UID, so per-worker isolation actually functions
    And its root filesystem is read-only and privilege escalation is disabled
    # As UID 1000 with all capabilities dropped the manager physically cannot
    # perform per-worker UID isolation — that was the known-broken prior config,
    # which also silently re-opened cross-worker credential theft.

  Scenario: The e2e manifest documents its two intentional local-only divergences
    Given the local end-to-end pod manifest for langy-agent
    Then it carries a prominent banner warning it must not be used in production
    And it records that the sandboxed runtime is omitted locally but required
      in production
    And it records that no NetworkPolicy is applied because a lone local test
      pod has no siblings to isolate on the network
