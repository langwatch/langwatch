Feature: The Helm chart installs on a cluster that enforces strict admission control
  As someone running LangWatch on a locked-down Kubernetes cluster,
  I want the chart's pods to satisfy the admission policies my platform team
  enforces,
  so that installing LangWatch is a helm command rather than a negotiation with
  the people who own the cluster.

  # Cross-references:
  #   ADR-033 — Langy worker isolation: why the assistant's manager runs as root.
  #   specs/langy/langy-deploy-hardening.feature — the per-worker UID model that
  #     root capability set exists to serve.
  #   charts/langwatch/examples/overlays/strict-admission.yaml — the overlay
  #     these scenarios describe.
  #   docs/self-hosting/security.mdx — the operator-facing version of this.
  #
  # Context. A self-hosted customer on a managed cluster with an OPA Gatekeeper
  # bundle could not install the chart: several enforced policies denied the
  # pods. The enforced set was seccomp profile present, no automounted
  # ServiceAccount token, resource requests and limits on every container, no
  # privilege escalation, and — with no exceptions — a read-only root
  # filesystem on every container.
  #
  # Two things make this hard to keep true. First, the policies VALIDATE rather
  # than mutate, so a missing field is a denial, not a default. Second, some
  # constraint implementations read the CONTAINER-level securityContext field
  # directly, so setting a value only at pod level — which Kubernetes itself
  # treats as inherited — is still a denial.
  #
  # The through-line: a workload is either hardened, or it is a recorded
  # exception that the strict-admission overlay removes. There is no third
  # category, and "we harden it by default and hope nobody overrides it" is a
  # bug — see the override scenarios at the end.

  # Tagging. These scenarios are verified by charts/langwatch/tests/e2e-overlays.sh
  # (test_pod_security), but the parity checker's shell binding roots scan .bats
  # only, so a chart-e2e scenario cannot bind to a .sh assertion as written.
  # They carry @e2e @unimplemented so the gap is a tracked one rather than an
  # untagged file, which the checker skips entirely — an untagged .feature
  # reports "0/0 all bound" and enforces nothing.

  # ===========================================================================
  # The posture every LangWatch workload carries
  # ===========================================================================

  @e2e @unimplemented
  Scenario: Every LangWatch workload and bundled datastore ships hardened
    Given the chart is rendered with its default values
    When I inspect each workload LangWatch authors, including the bundled
      PostgreSQL, Redis, ClickHouse and Keeper, but excluding the components
      recorded below as unable to comply
    Then every container runs with a read-only root filesystem
    And every container drops all Linux capabilities
    And every container disallows privilege escalation
    And every pod carries a RuntimeDefault seccomp profile
    And every pod declines to mount a ServiceAccount token
    And every container declares CPU and memory requests and limits

  @e2e @unimplemented
  Scenario: Non-root is asserted where a policy engine will actually look for it
    Given the chart is rendered with its default values
    When I inspect a workload's security context
    Then it declares non-root at the pod level
    And it declares non-root at the container level as well
    # Kubernetes inherits the pod-level value, so the container-level copy
    # changes no runtime behaviour. It exists because constraint
    # implementations that read the container field deny pods that carry the
    # value only on the pod, which is how the customer's install first failed.

  @e2e @unimplemented
  Scenario: A bundled datastore keeps its own image user
    Given the chart is rendered with its default values
    When I inspect a bundled datastore's security context
    Then it runs as the user its image ships with, not the shared default
    And it still carries the rest of the hardened posture
    # An operator writing a MustRunAs constraint needs to allow those uids, so
    # the documentation names them rather than implying a single uid.

  @e2e @unimplemented
  Scenario: Writable paths live on mounted volumes, never the image layer
    Given a bundled datastore is running with a read-only root filesystem
    When it writes the paths it needs at runtime
    Then persistent data is written to its own volume
    And any remaining runtime path is written to a mounted scratch volume
    And no write is attempted against the image layer

  @e2e @unimplemented
  Scenario: Scratch volumes cannot exhaust the node they run on
    Given a workload writes to a scratch volume rather than its data volume
    When it enters an error loop and writes without bound
    Then the workload is capped by its own volume quota
    And unrelated workloads on the same node keep their disk
    # An unbounded scratch volume is backed by node ephemeral storage, so the
    # failure lands on every neighbour rather than the pod that caused it.

  # ===========================================================================
  # What cannot comply, and what the operator does about it
  # ===========================================================================

  @e2e @unimplemented
  Scenario: A default install is honest that it does not pass on its own
    Given a cluster that enforces the restricted pod security standard
    When an operator installs the chart with default values
    Then the workloads LangWatch authors are admitted
    And the components that cannot comply are rejected
    And the documentation told them to expect this and which overlay to apply
    # The failure mode being designed out is a docs promise of "passes with no
    # extra config" that sends an operator into a denial they were told not to
    # expect.

  @e2e @unimplemented
  Scenario: The strict-admission overlay removes every non-complying component
    Given a cluster that enforces the restricted pod security standard
    When an operator installs the chart with the strict-admission overlay
    Then no workload in the release violates the enforced policies
    And the assistant is not deployed
    And the bundled metrics stack is not deployed

  @e2e @unimplemented
  Scenario: The assistant is removed rather than de-privileged
    Given the assistant's manager requires root and a narrow capability set so
      it can give each of its workers a distinct user id
    When an operator installs onto a cluster that forbids running as root
    Then the overlay opts the assistant out of the install entirely
    And the chart never quietly relaxes the assistant to run as non-root
    # Running that manager as an unprivileged user does not make it safe; it
    # makes sibling workers share a uid and read each other's credentials off
    # disk. Removing the workload is the safe answer, weakening it is not.

  @e2e @unimplemented
  Scenario: An exempt component must be one the overlay actually disables
    Given a workload that does not carry the hardened posture
    When the chart's own checks run
    Then that workload must be recorded as a known exception
    And the strict-admission overlay must remove it
    And a workload that is neither hardened nor recorded fails the checks
    # This is what stops a newly added subchart from shipping unhardened and
    # being noticed by a customer's admission controller rather than by us.

  # ===========================================================================
  # Overrides layer onto the posture, they do not replace it
  # ===========================================================================

  @e2e @unimplemented
  Scenario: A partial security-context override keeps the defaults it did not mention
    Given an operator overrides a single security-context field on one component
    When the chart is rendered
    Then the overridden field takes the operator's value
    And every other hardened default for that component is still present
    # Previously an override replaced the whole security context, so setting
    # one field — a group id for a storage class, say — silently dropped
    # non-root, the user id and the seccomp profile, and nothing in the
    # rendered output said so.

  @e2e @unimplemented
  Scenario: Deliberately relaxing one control does not relax the others
    Given an operator turns off the read-only root filesystem for one component
    When the chart is rendered
    Then only that control is relaxed
    And that component still drops all capabilities and disallows privilege
      escalation
