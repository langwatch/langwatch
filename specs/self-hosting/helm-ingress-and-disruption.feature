Feature: Helm install routing and disruption budgets

  A plain Helm install creates no Ingress for the app or the AI Gateway, so a
  cluster that runs Envoy Gateway, Traefik or another controller never gets
  objects tied to ingress-nginx. An operator who wants the chart Ingress turns
  it on and picks the class. The chart's PodDisruptionBudgets never block a
  node drain, so cluster upgrades and admission policies that reject such
  budgets both keep working.

  # Bindings: charts/gateway/tests/ingress-and-pdb.sh (the `helm` job in
  # .github/workflows/go-services.yaml) and
  # charts/langwatch/tests/gateway-ingress-and-pdbs.sh.

  Rule: The gateway Ingress is opt-in

    @unit
    Scenario: a default install creates no gateway Ingress
      Given a Helm install with no ingress values
      When the chart renders
      Then no Ingress object is rendered
      And no ingress-nginx annotation appears anywhere
      And the control plane is given no gateway public URL

    @unit
    Scenario: an enabled gateway Ingress uses the class the operator picked
      Given the gateway Ingress is enabled with host "gateway.acme.com" and class "envoy"
      When the chart renders
      Then the gateway Ingress has ingressClassName "envoy"
      And it carries no ingress-nginx annotation
      And the control plane is given "https://gateway.acme.com" as the gateway public URL when TLS is on
      And with no class set, the Ingress leaves ingressClassName unset for the cluster default

    @unit
    Scenario: ingress-nginx annotations apply only to an nginx gateway Ingress
      Given the gateway Ingress is enabled with class "nginx"
      When the chart renders
      Then the Ingress turns off proxy buffering and sets a 32m body size
      And an annotation the operator sets wins over the nginx default

    @unit
    Scenario: a gateway host without an enabled Ingress is refused
      Given a values file that sets the gateway Ingress host but does not enable it
      When the chart renders
      Then the render fails naming ingress.enabled
      And enabling the Ingress without a host fails naming ingress.host

  Rule: Disruption budgets never block a node drain

    @unit
    Scenario: the gateway PodDisruptionBudget never blocks a node drain
      Given the gateway runs its default two pods
      Then its PodDisruptionBudget allows one pod to be unavailable
      And no gateway PodDisruptionBudget renders when it runs a single pod
      And a budget that leaves no gateway pod evictable is refused

    @unit
    Scenario: a PodDisruptionBudget over a single pod is not rendered
      Given an operator sets a PodDisruptionBudget on the app, workers, NLP or LangEvals
      And that component runs one replica
      When the chart renders
      Then no PodDisruptionBudget renders for it
      And at two replicas the budget renders

    @unit
    Scenario: a PodDisruptionBudget that leaves no pod evictable is refused
      Given a component PodDisruptionBudget with minAvailable equal to replicaCount, minAvailable 100%, or maxUnavailable 0
      When the chart renders
      Then the render fails naming the component and the field
