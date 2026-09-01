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
  #   ADR-130 — per-worker identity isolation is the operator's choice: the
  #             posture scenarios in the third section below.
  #   ADR-131 — the opencode harness is removed; pi is the only harness.
  #
  # Why this matters. The langy-agent pod runs many workers, each holding a
  # DIFFERENT user's live credentials and executing LLM-generated shell — so a
  # prompt-injected worker A can be induced to attack worker B. Two controls
  # bound that:
  #   (1) the pod runs under a sandboxed runtime (gVisor/runsc) so a worker that
  #       breaks OUT of the container still cannot reach the node kernel;
  #   (2) the manager runs as root with a narrow capability set so it can hand
  #       each worker a DISTINCT UID — without which sibling workers share a UID
  #       and can read each other's live credentials out of the process
  #       environment, and each other's conversation content out of the session
  #       directory.
  #
  # Neither is an invariant, and this spec used to call them both one. Each is
  # a DEFAULT the operator can trade, deliberately and on the record: (1) via
  # acceptUnsandboxedRuntime, because most self-managed clusters cannot offer a
  # sandboxed runtime; (2) via the isolation posture in ADR-130, because a
  # cluster enforcing non-root admits no pod that can do (2) at all. What is
  # invariant is that neither is given up by accident — every trade is a value
  # written in the operator's own file, and the chart refuses to render without
  # it.
  #
  # On credentials: workers keep no secret on disk. The exposure a shared
  # identity opens is the worker's process environment and its session
  # directory, not a credential file — there isn't one (ADR-131 removed the
  # harness that had one).
  #
  # The chart already fails the render when replicaCount != 1 or when
  # service.type != ClusterIP. The guards below are the same family.

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
    # stops the agent running — and that can only happen after an operator has
    # chosen to pin one, which is the scenario below.

  Scenario: Pinning a RuntimeClass the cluster does not define fails closed, not unsandboxed
    Given an operator has pinned the langy-agent pod to a sandboxed runtime
    And the cluster defines no matching RuntimeClass
    When the install completes
    Then every other workload runs
    And no langy-agent pod runs without its sandbox
    And the install notes say where the reason is recorded
    # Not "Pending" — the pod never gets far enough to wait. Kubernetes'
    # RuntimeClass admission plugin refuses to create a pod naming a class it
    # cannot find (`pod rejected: RuntimeClass "..." not found`), so the
    # ReplicaSet's create call is what fails and no pod object exists at all.
    # That matters to the operator looking for it: `kubectl get pods` lists
    # nothing, which reads like the install skipped Langy rather than like a
    # failure. The reason is on the Deployment's ReplicaFailure condition, and
    # printing that command is what NOTES.txt does here.

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
  # Policy-locked clusters: trading per-worker identity isolation for an install
  #
  # ADR-130. The guards above are about the pod-to-HOST boundary. These are
  # about the boundary between one worker and the next, which costs the
  # container root plus five capabilities. A cluster running Pod Security
  # Admission "restricted", or a policy engine that requires runAsNonRoot,
  # refuses that pod outright — so on those clusters the choice is not
  # "isolated or less isolated", it is "Langy or no Langy".
  #
  # The failure this replaces was not a refusal. Helm merges the operator's
  # capability drop with the chart's adds, so the pod still REQUESTS the five
  # capabilities; and the kernel clears them anyway on the transition to a
  # non-root UID. The pod was admitted, went healthy, and died at the first
  # chown during provisioning — which reads like a Langy bug rather than a
  # policy outcome.
  #
  # Same shape as acceptUnsandboxedRuntime above, one rung down: the invariant
  # that survives is that nobody gives up sibling isolation by ACCIDENT.
  # ===========================================================================

  @unit @unimplemented
  Scenario: The chart refuses to render without per-worker identity isolation unless it is accepted
    Given the chart manages the langy-agent pod
    And the operator has turned per-worker identity isolation off
    And the operator has not accepted the reduced isolation
    When an operator renders the chart to deploy it
    Then the deploy fails before producing any manifests
    And the failure states that one conversation's worker will be able to read
      another's live credentials and conversation content
    And the failure names the value that accepts that risk deliberately

  @e2e
  Scenario: An operator can accept the reduced isolation and render a non-root pod
    Given the chart manages the langy-agent pod
    And the operator has turned per-worker identity isolation off
    And the operator has accepted the reduced isolation
    When an operator renders the chart to deploy it
    Then the pod renders successfully
    And the pod runs as a non-root user
    And the pod requests no capabilities at all
    # The point of the posture: this spec is admissible under Pod Security
    # Admission "restricted" and the common policy-engine rules without any
    # per-namespace or per-RuntimeClass exemption.

  @e2e
  Scenario: The default install keeps per-worker identity isolation
    Given an operator installs the umbrella chart with default values
    When the chart renders
    Then the agent keeps per-worker identity isolation
    And the acceptance value is not required for the render to succeed
    # Turning it off is the deviation, and it is the operator's to write down.

  @e2e @unimplemented
  Scenario: A cluster that refuses root admits the agent once isolation is traded away
    Given a cluster whose policy requires every pod to run as a non-root user
    And the operator has turned per-worker identity isolation off and accepted it
    When they install the chart
    Then the agent pod is admitted
    And it starts and serves conversations
    # This is the scenario the whole posture exists for. Without it the install
    # is refused at admission; with the default posture on such a cluster there
    # is no configuration that both satisfies the policy and runs the agent.

  @unit @unimplemented
  Scenario: An install that trades away isolation says so where an operator will find it
    Given the agent is configured without per-worker identity isolation
    When the manager starts
    Then it warns that one conversation's worker can read another's live
      credentials and conversation content
    And the warning is emitted at startup rather than on first use
    # So it lands in the first support bundle, instead of being reconstructed
    # from someone's values file after an incident. The wording matters: the
    # exposure is the worker's process environment and its session directory,
    # not a credential file — there isn't one.

  @unit
  Scenario: An unrecognized isolation setting fails closed
    Given the agent is configured with an isolation value the manager does not know
    When the manager starts
    Then it refuses to start
    And it never falls back to running workers under one identity
    # The dangerous posture is never what a typo selects.

  @unit
  Scenario: The manager does not reserve worker identities it cannot enforce
    Given the agent is running without per-worker identity isolation
    When a conversation's worker is provisioned
    Then no distinct identity is reserved for it
    And each conversation still gets its own directories
    # Reserving an identity nothing applies is a claim in the code that a
    # later reader will believe.

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
    When they install or upgrade the release
    Then it completes
    And it never fails for a permission they were never granted
    # Enforced by charts/langwatch/tests/restricted-rbac.sh, which reads the
    # templates instead of rendering them. That is not a shortcut: with no
    # cluster behind a render every lookup returns empty, so the forbidden
    # case cannot be reproduced by `helm template` at all. Keeping no
    # cluster-scoped read in any template is the mechanism; the outcome above
    # is what it buys.

  @unit
  Scenario: The install notes never depend on reading the cluster
    Given an operator whose permissions stop at the namespace they install into
    When the install finishes and prints its notes
    Then the notes print
    And nothing in them can fail the install that has already succeeded
    #
    # Deliberately only the one claim. Guidance that would have needed such a
    # read is printed as a command for the operator to run instead, but that
    # is not asserted here: the only way to check it is to grep the notes for
    # the command's own text, which passes by finding a string we wrote rather
    # than by testing anything. An unenforced Then inside a scenario the parity
    # checker calls bound is worse than one fewer Then.

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
    # perform per-worker UID isolation. That combination used to be reachable
    # only by mistake, which is why it is called out here: it looked like a
    # hardening win and silently re-opened cross-worker credential theft.
    # ADR-130 makes the same pod shape reachable ON PURPOSE, for clusters whose
    # policy admits nothing else — but it is a posture the operator selects and
    # acknowledges, not a default and not an accident. The e2e manifest keeps
    # the isolated posture, because what it exists to mirror is production.

  Scenario: The e2e manifest documents its two intentional local-only divergences
    Given the local end-to-end pod manifest for langy-agent
    Then it carries a prominent banner warning it must not be used in production
    And it records that the sandboxed runtime is omitted locally but required
      in production
    And it records that no NetworkPolicy is applied because a lone local test
      pod has no siblings to isolate on the network
