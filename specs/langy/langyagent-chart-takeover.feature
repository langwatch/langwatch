Feature: The langyagent chart can take over an existing agent Deployment
  An install that already runs the agent from objects created by another tool
  (raw manifests, Terraform, another chart) can move them to this chart without
  deleting them. Helm adopts an existing object in place, but a Deployment's
  selector can never change after creation, so the chart has to be able to
  render the selector, names, labels and settings the existing objects have.
  A fresh install sets none of these values and renders exactly as before.
  Helm itself still refuses an object it does not own: the takeover install
  runs with --take-ownership (Helm 3.17 or later), or each object is first
  annotated with meta.helm.sh/release-name and meta.helm.sh/release-namespace
  and labelled app.kubernetes.io/managed-by=Helm.

  Bound by charts/langwatch/tests/langyagent-takeover.sh.

  @regression
  Scenario: A fresh install renders the default selector
    Given the langyagent chart with its default values
    When it is rendered
    Then the Deployment selector is the chart's name and instance labels
    And the Service and NetworkPolicy select the same labels

  @regression
  Scenario: Custom selector labels reach every selector
    Given selectorLabels names an existing Deployment's selector
    When the chart is rendered
    Then the Deployment selector is exactly those labels
    And the pod template carries them
    And the Service selector and the NetworkPolicy podSelector are those labels

  @regression
  Scenario: Pod labels never displace a selector label
    Given selectorLabels sets a label
    And podLabels sets the same label to another value
    When the chart is rendered
    Then the pod template keeps the selector's value

  @regression
  Scenario: Extra environment entries are appended to the agent container
    Given extraEnvs lists an entry that reads a Secret key
    When the chart is rendered
    Then the agent container has that entry after the chart's own

  @regression
  Scenario: Extra config adds keys to the agent ConfigMap
    Given extraConfig sets a key the chart does not write
    When the chart is rendered
    Then the ConfigMap carries that key

  @regression
  Scenario: Extra config cannot replace a key the chart writes
    Given extraConfig sets ENVIRONMENT
    When the chart is rendered
    Then the render fails and names the value to use instead

  @regression
  Scenario: Extra environment entries cannot replace a variable the chart sets
    Given extraEnvs sets ENVIRONMENT, which the chart writes to the ConfigMap
    When the chart is rendered
    Then the render fails and names the value to use instead

  @regression
  Scenario: Service annotations and the rollout deadline are rendered when set
    Given service.annotations and progressDeadlineSeconds are set
    When the chart is rendered
    Then the Service carries the annotations, each value a string
    And the Deployment has that progress deadline

  @regression
  Scenario: The scratch volume can be uncapped
    Given scratchSizeLimit is empty
    When the chart is rendered
    Then the tmp emptyDir has no size limit
