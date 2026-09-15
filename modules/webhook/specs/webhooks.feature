Feature: Enterprise webhook endpoints
  Organizations configure destinations and receive versioned event envelopes
  through one portable contract and one durable delivery workflow.

  @unit
  Scenario: Registered selectors validate and match
    Given the webhook event catalog
    Then exact event names, family wildcards, and the match-all selector validate
    And an empty subscription matches nothing

  @unit
  Scenario: Endpoint secrets never appear in read values
    When an endpoint is represented by the portable view schema
    Then signing and destination secret values are absent

  @unit @architecture
  Scenario: Endpoint access uses the shared entitlement service
    Given an organization requests webhook endpoint access
    When the webhook access service checks the plan
    Then it calls the core Entitlement service
    And it maps a disabled webhook capability to the webhook handled error
    And no webhook-specific entitlement service or plan repository is created

  @unit
  Scenario: Delivery retry follows the stable ladder
    Given a webhook batch has failed
    Then the next attempt uses the declared retry delay
    And exhausted attempts become terminal dead-letter work

  @integration
  Scenario: Emitted events are tenant scoped
    Given an organization has a set of project tenants
    When it lists or reads emitted webhook events
    Then only rows from those tenants are mapped to envelopes
