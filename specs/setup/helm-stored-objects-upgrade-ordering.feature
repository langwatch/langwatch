Feature: A chart upgrade moves one stored-objects volume consumer at a time
  As someone who runs LangWatch on their own cluster with local-filesystem
  stored objects,
  I want the upgrade to stand the workers down before it rolls the app,
  so that my pods do not wedge in ContainerCreating on a multi-attach error.

  # Cross-references:
  #   charts/langwatch/templates/app/stored-objects-pvc.yaml — the ReadWriteOnce
  #     volume, rendered only when local-filesystem is the active backend.
  #   charts/langwatch/templates/app/stored-objects-serialize-upgrade.yaml — the
  #     pre-upgrade hook this feature describes.
  #   charts/langwatch/templates/workers/deployment.yaml — the second consumer of
  #     that volume, and the replicas the release restores.
  #   charts/langwatch/templates/_helpers.tpl —
  #     langwatch.storedObjects.localFilesystemIsActive (the gate this hook shares
  #     with the PVC) and langwatch.terminationGracePeriod (the shutdown budget the
  #     wait must cover).
  #   charts/langwatch/tests/stored-objects-upgrade-ordering.sh — the suite that
  #     renders the chart and asserts what this feature describes.
  #   specs/event-sourcing/worker-graceful-shutdown.feature — where the 55 second
  #     grace period comes from.
  #
  # Context. In local-filesystem mode the app Deployment and the workers
  # Deployment mount the same ReadWriteOnce PersistentVolumeClaim. A
  # ReadWriteOnce volume attaches to one node, so every consumer must sit on
  # that node. The chart already defends this inside each Deployment: both use a
  # kill-then-start rollout (maxSurge=0, maxUnavailable=1), the workers carry a
  # required podAffinity to the app pod, and the chart refuses more than one
  # replica of either.
  #
  # Those defenses are per Deployment. A helm upgrade rolls both Deployments at
  # the same time and nothing orders them, so on a cluster with more than one
  # node the new pod of one Deployment can be scheduled on a fresh node while the
  # old pod of the other still holds the volume attachment on the old node. Both
  # pods then wedge in ContainerCreating with a multi-attach error, and the
  # attach-detach controller can hold that state for many minutes. A customer hit
  # this on a 3.14.0 upgrade and recovered by scaling the workers to 0, redoing
  # the rollout, and scaling the workers back up.
  #
  # The fix makes that recovery part of the upgrade. A pre-upgrade hook Job scales
  # the workers Deployment to 0 and waits until its pods are gone. Helm then
  # applies the new manifests with the app as the only consumer of the volume,
  # which the kill-then-start rollout already handles, and the workers Deployment
  # comes back at the replica count its manifest names and follows the new app pod
  # through the affinity that is already there.
  #
  # These scenarios are verified by rendering the chart. The hook is a Go template
  # over several values, so a gate that is written the wrong way round, a wait that
  # is shorter than the shutdown budget, or an RBAC rule that grew wider is only
  # visible in the rendered output. Each scenario binds to a test function in
  # charts/langwatch/tests/stored-objects-upgrade-ordering.sh, which the parity
  # checker discovers through its shell-test root.

  Rule: Local-filesystem installs stand the workers down before the app rolls

    @e2e
    Scenario: A local-filesystem install gets a pre-upgrade step
      Given the default install, which keeps stored objects on a local filesystem
      When the chart renders
      Then the release carries a pre-upgrade step that stands the workers down
      And that step runs before helm changes any Deployment

    @e2e
    Scenario: The pre-upgrade step scales the workers to zero and waits for the pods
      Given the default install
      When the chart renders
      Then the step scales the workers Deployment to zero replicas
      And it waits for the workers pods to be gone before it reports success

    @e2e
    Scenario: The wait outlasts the time the workers may take to shut down
      Given the workers may take their whole grace period to exit
      When the chart renders
      Then the step waits longer than that grace period
      And raising the grace period raises the wait with it

    @e2e
    Scenario: The workers come back at the replica count the release names
      Given a release that names a worker replica count
      When the chart renders the workers Deployment
      Then the count is part of the manifest, so applying the release restores it
      after the step scaled it to zero

  Rule: The step renders only where the shared volume exists

    @e2e
    Scenario: An install with object storage gets no pre-upgrade step
      Given an install that keeps stored objects in S3 or Azure Blob
      When the chart renders
      Then there is no pre-upgrade step, because no volume is shared

    @e2e
    Scenario: An install without workers gets no pre-upgrade step
      Given an install that does not deploy the workers
      When the chart renders
      Then there is no pre-upgrade step, because only the app holds the volume

    @e2e
    Scenario: An operator can turn the pre-upgrade step off
      Given an operator who orders the rollout themselves
      When they turn the serialize-upgrades knob off and the chart renders
      Then there is no pre-upgrade step
      And the rest of the local-filesystem install is unchanged

  Rule: The step is safe to run and safe to fail

    @e2e
    Scenario: The step may touch only the workers Deployment and the pods beside it
      Given the step needs the Kubernetes API to scale a Deployment
      When the chart renders its permissions
      Then it may read and change the scale of the workers Deployment by name
      And it may read the pods in its own namespace and nothing else
      And it holds no permission that reaches outside its namespace

    @e2e
    Scenario: A first install is not blocked by the step
      Given a cluster where the workers Deployment does not exist yet
      When the step runs
      Then it reports success and changes nothing

    @e2e
    Scenario: A failed step does not block the next upgrade
      Given a step that failed and was left behind for the operator to read
      When the operator starts the next upgrade
      Then the old Job is removed first, so the new one can be created
