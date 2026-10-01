Feature: Helm install routing and disruption budgets

  A plain Helm install creates no Ingress, so a cluster that runs Envoy
  Gateway, Traefik or another controller never gets objects tied to
  ingress-nginx. The AI Gateway has no Ingress of its own: an operator
  publishes it from the app Ingress settings with ingress.gateway.host. The
  chart's PodDisruptionBudgets never block a node drain, so cluster upgrades
  and admission policies that reject such budgets both keep working.

  # Bindings: charts/gateway/tests/ingress-and-pdb.sh (the `helm` job in
  # .github/workflows/go-services.yaml) and
  # charts/langwatch/tests/gateway-ingress-and-pdbs.sh.

  Rule: The gateway is published from the app Ingress settings

    @unit
    Scenario: a default install creates no gateway Ingress
      Given a Helm install with no ingress values
      When the chart renders
      Then no Ingress object is rendered
      And no ingress-nginx annotation appears anywhere
      And the control plane is given no gateway public URL

    @unit
    Scenario: the gateway host follows the app Ingress settings
      Given the app Ingress is enabled with class "envoy" and a cert-manager annotation
      And ingress.gateway.host is "gateway.acme.com" with TLS secret "gateway-tls"
      When the chart renders
      Then a second Ingress routes /v1 and /health on that host to the gateway Service
      And it has ingressClassName "envoy", the app annotations and the TLS secret
      And it carries no ingress-nginx annotation
      And the control plane is given "https://gateway.acme.com" as the gateway public URL
      And without ingress.gateway.host no gateway Ingress renders

    @unit
    Scenario: ingress-nginx streaming settings apply only to an nginx gateway host
      Given the app Ingress uses class "nginx"
      And ingress.gateway.host is set
      When the chart renders
      Then the gateway Ingress turns off proxy buffering, sets a 3600s read timeout and a 32m body size
      And ingress.gateway.annotations win over those defaults
      And the app Ingress keeps only its own annotations

    @unit
    Scenario: a gateway host without an enabled Ingress is refused
      Given ingress.gateway.host is set and ingress.enabled is not
      When the chart renders
      Then the render fails naming ingress.enabled

    @unit
    Scenario: a gateway host without a gateway in the release is refused
      Given ingress.gateway.host is set and gateway.chartManaged is false
      When the chart renders
      Then the render fails naming gateway.chartManaged

    @unit
    Scenario: retired gateway ingress values are refused
      Given a values file that still sets gateway.ingress.enabled true or gateway.ingress.host
      When the chart renders
      Then the render fails naming ingress.gateway.host
      And gateway.ingress.enabled false on its own still renders

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
      And percentages are resolved the way Kubernetes rounds them, so minAvailable 75% of 2 pods and maxUnavailable 0% are refused too
