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

  # Measured against main on 2026-09-21: GET /endpoints and /event-types
  # returned a bare array here where main answers {"data": [...]}. The envelope
  # cannot simply be dropped — /endpoints/{id}/deliveries pages, and
  # next_cursor has nowhere to live beside a bare array — so restoring it on
  # the other two is the only shape that is both prod-compatible and
  # internally consistent.
  @integration
  Scenario: A webhook list answers under its own data envelope
    Given the webhook endpoints and event-type lists
    When each is read
    Then each answers under "data"

  @unit @integration
  Scenario: A queue endpoint delivers to its queue through the process's AWS transport
    Given an endpoint whose destination is an Amazon SQS queue
    When a batch is delivered or the endpoint is test-fired
    Then the exact batch body goes on the queue with the signature, delivery id and attempt as message attributes
    And a queue that refuses the send is classified terminal or retryable from the SDK error, never thrown
    And a batch over the message limit is refused terminally
    And an HTTPS endpoint still sends through the egress

  @unit
  Scenario: Queue deliveries follow the configured outbound proxy
    Given an outbound HTTP proxy is configured for the environment
    When a batch is delivered to an endpoint whose destination is an Amazon SQS queue
    Then the send to the queue host is routed through the proxy
    And a queue host listed as a proxy exception is contacted directly
