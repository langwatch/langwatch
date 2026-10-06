Feature: Webhook delivers gateway's spend and governance facts from its own side
  Gateway records spend steps and governance facts on its own pipelines and knows nothing of
  webhook. Webhook subscribes to those events as a peer (ARCHITECTURE §5, §9) and queues each
  one for delivery under its event id, at least once and idempotent per event id. The spend
  replay reads only webhook's endpoints, emitted log and stream, so webhook answers it, at
  main's path, body, answer, permission and plan gate.

  @unit
  Scenario: Each committed gateway spend step is queued for delivery under its own event id
    Given webhook's peer subscribers on gateway's spend events
    When a confirmed spend event reaches its subscriber
    Then delivery is requested once, named by the event's id
    And the request carries the spend step's type and data unchanged

  @unit
  Scenario: A recorded governance fact is queued for delivery under its own event id
    Given webhook's peer subscribers on gateway's governance events
    When a budget crossing reaches its subscriber
    Then delivery is requested once, named by the event's id
    And the request carries the crossing's type and data unchanged

  @unit
  Scenario: A redelivered gateway spend event is delivered once
    Given a memory-tier worker with one active HTTP endpoint
    When a request's admitted and confirmed spend events each reach webhook's subscribers twice
    Then the delivery log records one attempt for the endpoint
    And webhook_delivery holds one requested event per gateway event

  @unit
  Scenario: A gateway fact appended twice under one idempotency key is delivered once
    Given a memory-tier worker with one active HTTP endpoint
    When each spend fact reaches webhook's subscribers twice, under distinct event ids and one idempotency key
    Then the delivery log records one attempt for the endpoint
    And webhook_delivery holds one requested event per fact, keyed by its idempotency key

  @unit
  Scenario: The spend replay answers at main's path behind main's permission and plan gate
    Given webhook's replay route mounted with its plan gate
    When an organization whose plan lacks billing events posts a replay
    Then it is refused with 403 naming the enterprise feature
    And a request with no credential is refused with 401
