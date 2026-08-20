Feature: Provider worker pools stay proportionate to the traffic they serve
  As an operator running the gateway
  I want each provider's worker pool sized for what the gateway actually dispatches
  So that registering every supported provider doesn't cost the process tens of
  thousands of idle goroutines

  Background:
    The gateway advertises every provider bifrost supports, because a virtual
    key may name any of them and bifrost resolves provider configuration by
    provider key alone. Bifrost creates the worker pool eagerly, per provider,
    and its own defaults are 1000 workers with a 5000-slot queue — sized for a
    deployment where a single provider fronts the whole gateway.

    Taken across the whole standard provider list those defaults are paid
    dozens of times over, for providers a given install may never dispatch to.
    In production that was measured at roughly 21,000 permanently parked
    goroutines per pod — 99.85% of every goroutine in the process. Idle
    goroutines are not free: the garbage collector rescans every one of their
    stacks on each mark cycle, and continuous profiling serialises them on
    every upload.

    A pool bounds in-flight upstream requests; it does not cap throughput. A
    burst past the pool queues rather than fails, because the gateway leaves
    bifrost's drop-on-overflow behaviour off.

    # Bindings: services/aigateway/adapters/providers/worker_pool_test.go
    # Sender: services/aigateway/adapters/providers/bifrost.go (account.GetConfigForProvider)

  @unit
  Scenario: A standard provider gets an explicit worker pool rather than the library default
    Given the gateway builds the connection configuration for a standard provider
    When bifrost creates that provider's worker pool
    Then the pool is the gateway's own bounded size
    And it is not the library's thousand-worker default

  @unit
  Scenario: Every advertised provider is bounded
    Given the gateway advertises the full list of standard providers
    When the connection configuration is built for each of them in turn
    Then none of them falls back to the library's default pool size
    # A provider added by a future bifrost upgrade must be bounded too: the
    # cost of this defect scales with the length of the advertised list, so
    # the guard walks the list rather than a sample of it.

  @unit
  Scenario: A URL-derived compat endpoint keeps its own bound
    Given a customer-configured Anthropic-compatible endpoint
    When the connection configuration is built for its derived provider key
    Then that endpoint's pool is bounded independently of the standard providers
    # Compat endpoints are bounded by their own registry cap as well, so their
    # sizing is a separate decision that this change must not disturb.
