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
    And the operator has not accepted running without one
    When an operator renders the chart to deploy it
    Then the deploy fails before producing any manifests
    And the failure names the missing sandboxed runtime
    And the failure explains that running this workload without a sandbox
      re-opens the pod-to-host escape surface
    And the failure names the value that accepts that risk deliberately
    # Same family as the existing replicaCount and service.type render guards.

  # Most self-managed clusters cannot offer a sandboxed runtime, and refusing
  # them outright made the assistant hosted-only in practice. The invariant that
  # survives is narrower and still worth having: nobody runs this workload
  # unsandboxed by ACCIDENT. Accepting the reduced isolation is a value the
  # operator writes down, so it shows up in their own values file and in review,
  # rather than being the silent consequence of leaving a field blank.
  Scenario: An operator can accept the reduced isolation and render without a sandbox
    Given the chart manages the langy-agent pod
    And no sandboxed runtime is configured for the pod
    And the operator has accepted running without one
    When an operator renders the chart to deploy it
    Then the pod renders successfully
    And the pod is not pinned to any sandboxed runtime

  Scenario: The chart renders with the sandboxed runtime set
    Given the chart manages the langy-agent pod
    And the sandboxed runtime is set to "gvisor"
    When an operator renders the chart to deploy it
    Then the pod renders successfully
    And the pod is pinned to the sandboxed runtime

  Scenario: A default install runs Langy on a cluster that offers no sandboxed runtime
    Given an operator installs the umbrella chart with default values
    And the cluster offers no sandboxed runtime
    When the install completes
    Then every workload runs, Langy included
    And the install notes state which isolation posture this install got
    And the install notes explain where a sandboxed runtime comes from on each major cloud
    And the install notes name the values that pin the pod to one
    # The defaults are an empty runtimeClassName with acceptUnsandboxedRuntime
    # true, so Langy is available on any cluster and hardening is a deliberate
    # later step. Pinning a RuntimeClass the cluster does not define is what
    # leaves the pod Pending — and that can only happen after an operator has
    # chosen to pin one, which is the scenario below.

  Scenario: Pinning a RuntimeClass the cluster does not define leaves the pod Pending, not unsandboxed
    Given an operator has pinned the langy-agent pod to a sandboxed runtime
    And the cluster defines no matching RuntimeClass
    When the install completes
    Then every other workload runs
    And the langy-agent pod waits rather than running without its sandbox
    And the install notes say where the reason for the wait is recorded

  Scenario: The guard does not fire when the agent is not chart-managed
    Given the chart does not manage the langy-agent pod
    And no sandboxed runtime is configured for the pod
    When an operator renders the chart
    Then rendering succeeds without requiring a sandboxed runtime
    # Opting the whole pod out needs no acceptance: there is no workload to
    # sandbox. Blanking the runtime while still managed does, and is refused
    # until the operator accepts it (see the scenario above, and
    # specs/langy/langy-selfhost-install.feature for the operator's story).

  # ===========================================================================
  # Restricted clusters: rendering asks for no permission the operator lacks
  # ===========================================================================

  # A customer upgrade died here. Their platform team is scoped to the namespace
  # they install into, and the install notes tried to list the cluster's
  # RuntimeClasses so they could offer an optional hardening tip. Helm reports a
  # DENIED lookup as a template error rather than as an empty result, so advice
  # nobody had asked for took the whole upgrade down:
  #
  #   Error: UPGRADE FAILED: template: langwatch/templates/NOTES.txt:102:11:
  #   ... error calling lookup: runtimeclasses.node.k8s.io is forbidden: User
  #   "..." cannot list resource "runtimeclasses" in API group "node.k8s.io" at
  #   the cluster scope
  #
  # Nothing in the render matrix catches this. With no cluster behind the
  # render every lookup returns empty and the branch is simply skipped, so the
  # failure exists only on a cluster whose RBAC actually refuses — which is to
  # say, only on the customer's.

  @unit
  Scenario: A restricted installer can render the chart without cluster-scoped read access
    Given an operator whose permissions stop at the namespace they install into
    When they render the chart
    Then no part of the render asks to read a cluster-scoped resource
    And the render never fails for a permission the operator was not granted

  @unit
  Scenario: The install notes never depend on reading the cluster
    Given the install notes
    Then nothing in them reads the cluster to decide what to print
    And guidance that would need such a read is printed as a command the
      operator can choose to run themselves
    # The notes are advice printed after the install has already succeeded.
    # Nothing in them is worth failing an install over.

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
