Feature: A chart upgrade moves one stored-objects volume consumer at a time
  As someone who runs LangWatch on their own cluster with local-filesystem
  stored objects,
  I want the workers to stay off the shared volume while the app rolls,
  so that my pods do not wedge in ContainerCreating on a multi-attach error.

  # Cross-references:
  #   charts/langwatch/templates/app/stored-objects-pvc.yaml: the ReadWriteOnce
  #     volume, rendered only when local-filesystem is the active backend.
  #   charts/langwatch/templates/app/stored-objects-serialize-upgrade.yaml: the
  #     pre-upgrade and post-upgrade hooks this feature describes.
  #   charts/langwatch/templates/workers/deployment.yaml: the second consumer of
  #     that volume, and the podAffinity that ties it to the app pod.
  #   charts/langwatch/templates/_helpers.tpl:
  #     langwatch.storedObjects.localFilesystemIsActive (the gate these hooks
  #     share with the PVC), langwatch.storedObjects.colocationAffinity, and
  #     langwatch.terminationGracePeriod (the shutdown budget the waits cover).
  #   charts/langwatch/tests/stored-objects-upgrade-ordering.sh: the suite that
  #     renders the chart and asserts what this feature describes.
  #   specs/event-sourcing/worker-graceful-shutdown.feature: where the 55 second
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
  # The fix makes that recovery part of the upgrade, in two steps. A pre-upgrade
  # hook scales the workers to 0 and waits for their pods to go away, so the old
  # workers pod cannot hold the volume while helm rolls the app. A post-upgrade
  # hook scales them to 0 again, waits for the app rollout to finish, and only
  # then gives the workers back.
  #
  # The second step is not redundant. Helm's apply restores the replica count
  # from the manifest, so a new workers pod is created at the same instant as the
  # new app pod. Its required podAffinity matches the old app pod, which is still
  # terminating on the old node, so the scheduler puts the workers back on the
  # node the app is leaving, where they take over the attachment and wedge the
  # new app pod for good. This was measured on a four node EKS cluster: with the
  # pre-upgrade step alone, an upgrade that moved the app to another node left it
  # in ContainerCreating with "Multi-Attach error ... Volume is already used by
  # pod(s) <release>-app-<old>".
  #
  # These scenarios are verified by rendering the chart. The hooks are Go
  # templates over several values, so a gate that is written the wrong way round,
  # a wait that is shorter than the shutdown budget, or an RBAC rule that grew
  # wider is only visible in the rendered output. Each scenario binds to a test
  # function in charts/langwatch/tests/stored-objects-upgrade-ordering.sh, which
  # the parity checker discovers through its shell-test root.

  Rule: The workers stay off the shared volume for the whole upgrade

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
    Scenario: The workers come back only after the app pod that holds the volume is running
      Given helm restores the replica count as soon as it applies the release
      When the chart renders
      Then a post-upgrade step stands the workers down again
      And it waits for the app rollout to finish
      And it reads that from the new pod, never from the one it replaced
      And it then scales the workers back to the count the release names

  Rule: The steps render only where the shared volume exists

    @e2e
    Scenario: An install with object storage gets no upgrade steps
      Given an install that keeps stored objects in S3 or Azure Blob
      When the chart renders
      Then there are no upgrade steps, because no volume is shared

    @e2e
    Scenario: An install without workers gets no upgrade steps
      Given an install that does not deploy the workers
      When the chart renders
      Then there are no upgrade steps, because only the app holds the volume

    @e2e
    Scenario: An operator can turn the upgrade steps off
      Given an operator who orders the rollout themselves
      When they turn the serialize-upgrades knob off and the chart renders
      Then there are no upgrade steps
      And the rest of the local-filesystem install is unchanged

  Rule: The steps are safe to run and safe to fail

    @e2e
    Scenario: The steps may touch only the two Deployments and the pods beside them
      Given the steps need the Kubernetes API to scale a Deployment
      When the chart renders their permissions
      Then they may read the app and the workers Deployments by name
      And they may change the scale of the workers Deployment and nothing else
      And they may read the pods in their own namespace
      And they hold no permission that reaches outside their namespace

    @e2e
    Scenario: A first install is not blocked by the steps
      Given a cluster where the workers Deployment does not exist yet
      When a step runs
      Then it reports success and changes nothing

    @e2e
    Scenario: A slow or broken app never leaves the workers switched off
      Given an app that does not finish its rollout in time
      When the post-upgrade step gives up waiting
      Then it warns, scales the workers back up, and reports success
      # A problem with the app must never also be a silent loss of workers.

    @e2e
    Scenario: A failed step does not block the next upgrade
      Given a step that failed and was left behind for the operator to read
      When the operator starts the next upgrade
      Then the old Job is removed first, so the new one can be created
