Feature: AI Gateway — Virtual Key provider access

  The "Provider access" section of the virtual-key drawers lets an operator
  pick which model providers a key may dispatch to. The list it offers is the
  scope-reachable set: every provider the key reaches through its ownership.

  A routing policy narrows what the gateway DISPATCHES to, never what the key's
  provider allowlist may name. A provider the scope reaches but the policy
  omits stays offered and is savable; the request to it is blocked at dispatch
  by the policy intersection, not at save. Blocking the save too would be
  over-strict, because the dispatch path already refuses the provider.

  This feature pins the provider-access UI and its allowlist validation: the
  routing-policy-versus-allowlist rule, the "All providers" master checkbox,
  and the row order.

  Background:
    Given organization "acme"
    And organization "acme" has team "platform" with project "demo"

  # ============================================================================
  # Routing policy narrows dispatch, not the allowlist
  # ============================================================================

  @integration
  Scenario: A scope-reachable provider can be allowed on a key even when the routing policy omits it
    Given a VirtualKey scoped to project "demo" on a routing policy
    And the policy omits a provider the key's scope reaches
    Then the omitted provider stays in the scope-reachable set the drawer offers
    And the server accepts it in the key's provider allowlist
    But the gateway dispatch set for the key excludes it

  @integration
  Scenario: The routing policy still narrows the dispatch chain when the allowlist names an omitted provider
    Given a VirtualKey on a routing policy that omits provider "extra"
    And the key's provider allowlist includes "extra"
    When the gateway materialises the key's config
    Then the dispatch providers exclude "extra"

  # ============================================================================
  # Request-time block names the reason
  # ============================================================================

  @integration
  Scenario: The bundle names why each undispatchable provider was dropped
    Given a VirtualKey on a routing policy, with an allowlist that omits some scope-reachable providers
    When the gateway materialises the key's config
    Then routing_excluded_providers names the providers the policy dropped, with their kind
    And access_excluded_providers names the scope-reachable providers the allowlist dropped, with their kind
    And routing_policy_name carries the policy's name

  @integration
  Scenario: A blocked request names why the resolved provider was not used
    Given a request resolves to a provider that has no dispatchable credential on the key
    Then the gateway blocks the request with a reason
    And the reason names the routing policy when the policy dropped the provider
    And the reason names the key's provider access when the allowlist dropped the provider
    And the reason names the key's scope when the provider is not reachable from it

  # ============================================================================
  # "All providers" master checkbox
  # ============================================================================

  @integration
  Scenario: Unchecking All providers clears the selection
    Given the provider-access section with "All providers" checked
    When the operator unchecks "All providers"
    Then no provider row stays checked
    And the section asks the operator to select at least one provider

  # ============================================================================
  # Row order — broadest scope first, then name
  # ============================================================================

  @unit
  Scenario: Provider access lists organization scope before team before project
    Given providers defined at organization, team and project scope
    When the drawer resolves the eligible providers
    Then organization-scoped providers come first, then team, then project
    And providers at the same scope are ordered by name
