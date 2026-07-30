Feature: Metrics collection in a deployed chart
  As an operator running LangWatch from the Helm chart
  I want to know that both tiers come up and that metrics can actually be collected
  So that turning the bearer gate on does not silently cost me observability

  # WHY THIS EXISTS
  #
  # The chart's e2e install only ever ran in ONE metrics configuration: the
  # default, where no key is configured at all. Every live assertion about
  # /metrics therefore described the fail-closed branch, and the branch an
  # operator actually runs in production — a key IS configured, and Prometheus
  # scrapes with a bearer — had no live coverage anywhere.
  #
  # That is the gap this feature closes. It pins the whole matrix as an
  # operator observes it: do the pods come up, and can metrics be collected,
  # for each way of configuring (or not configuring) the key.
  #
  # The liveness path is deliberately excluded from the gate in every one of
  # these configurations — see specs/server/worker-liveness-probe.feature for
  # why a probe can never carry a credential.

  Background:
    Given the chart is installed with the app and workers tiers enabled

  Rule: Both tiers come up in every metrics configuration

    Scenario: Default install, with no metrics key configured
      Given no metrics API key is configured
      Then the app pod becomes ready
      And the workers pod becomes ready

    Scenario: Install with a metrics key configured
      Given a metrics API key is configured
      Then the app pod becomes ready
      And the workers pod becomes ready

    Scenario: Install with the metrics key delivered from a secret store
      Given a metrics API key is delivered to the containers from a secret store
      Then the app pod becomes ready
      And the workers pod becomes ready

  Rule: Without a key, metrics collection fails closed and liveness still answers

    Scenario: The worker refuses to serve metrics to anyone
      Given no metrics API key is configured
      When a caller requests the worker metrics endpoint with any credentials
      Then the request is refused
      And no metric samples are returned
      # Fail-closed: an unset key is a misconfiguration, not an invitation.

    Scenario: Liveness is unaffected by the missing key
      Given no metrics API key is configured
      When the kubelet requests the worker liveness endpoint without credentials
      Then the response is successful
      # The reason the probe cannot use the metrics endpoint at all.

  Rule: With a key, metrics are collectable only by an authenticated caller

    Scenario: An unauthenticated scrape is rejected
      Given a metrics API key is configured
      When a caller requests the worker metrics endpoint without credentials
      Then the request is rejected as unauthorized
      And no metric samples are returned

    Scenario: A scrape presenting the wrong credential is rejected
      Given a metrics API key is configured
      When a caller requests the worker metrics endpoint with an incorrect key
      Then the request is rejected as unauthorized
      And no metric samples are returned

    Scenario: An authenticated scrape collects worker metrics
      Given a metrics API key is configured
      When a caller requests the worker metrics endpoint with the configured key
      Then the response is successful
      And metric samples are returned
      # The path Prometheus actually uses. Previously unproven in a cluster.

    Scenario: An authenticated scrape collects app metrics
      Given a metrics API key is configured
      When a caller requests the app metrics endpoint with the configured key
      Then the response is successful
      And metric samples are returned

    Scenario: The liveness endpoint stays credential-free even once a key exists
      Given a metrics API key is configured
      When the kubelet requests the worker liveness endpoint without credentials
      Then the response is successful
      # Configuring a key must never start requiring one from the kubelet.

  Rule: A key delivered from a secret store reaches the process

    Scenario: An authenticated scrape collects metrics when the key came from a secret
      Given a metrics API key is delivered to the containers from a secret store
      When a caller requests the worker metrics endpoint with the configured key
      Then the response is successful
      And metric samples are returned
      # Rendering the secret reference correctly is not the same as the value
      # arriving in the process — this asserts the latter, in a live cluster.
