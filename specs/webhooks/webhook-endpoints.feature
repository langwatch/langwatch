Feature: Webhook endpoints, signed outbound event delivery
  Stripe-shaped webhook platform: an organization registers endpoints with
  per-endpoint event subscriptions, and the platform delivers signed,
  batched, versioned envelopes with a multi-day retry ladder, a visible
  per-attempt delivery log carrying the receiver's own status codes, and
  automatic disabling of endpoints that fail for three days straight.
  Delivery is push over a persisted event log, never the only copy of it.

  Background:
    Given an organization on an enterprise plan with webhook endpoints

  Rule: Subscriptions select events explicitly, like Stripe

    @unit
    Scenario: An endpoint receives only the event types it subscribed to
      Given an endpoint subscribed to gateway request completed events
      When a matching event and a non-matching event exist
      Then only the matching event is selected for that endpoint

    @unit
    Scenario: A family wildcard subscribes to every type in the family
      Given an endpoint subscribed to the gateway family wildcard
      Then every gateway event type matches it
      And no other family matches it

    @unit
    Scenario: An empty subscription receives nothing
      Given an endpoint with no enabled events
      Then no event type matches it

    @unit
    Scenario: Unknown event selectors are rejected at save time
      When an endpoint is saved with a selector the registry does not know
      Then the save is rejected with a validation error

  Rule: The delivery process manager consumes the event log exactly once

    @integration
    Scenario: A confirmed spend event becomes exactly one delivery per endpoint
      Given an admitted request whose confirmation arrives
      When the process manager consumes both events
      Then one send message exists for the endpoint carrying the full envelope
      And the envelope joins the admission attribution with the outcome

    @integration
    Scenario: A redelivered event never queues a second envelope
      Given a confirmed event the process manager already consumed
      When the same event is delivered again
      Then the transactional inbox absorbs it
      And no second send message exists

    @integration
    Scenario: Failed requests are delivered as completed with their error class
      Given a request that failed at the provider
      When the process manager consumes the failure
      Then a completed envelope carries the error class and error status

    @integration
    Scenario: A settled request goes out as its own event type
      Given an admitted request whose confirmation never arrived
      When the settlement is consumed
      Then the envelope type is settled, never completed
      And its cost and usage are null because unknown is not zero
      And it is flagged for reconciliation with the settle reason

    @integration
    Scenario: A late confirmation supersedes the settled event
      Given a request already delivered as settled
      When its confirmation finally arrives
      Then a completed envelope is delivered for the same gateway request id
      And the two envelopes carry distinct event ids
      And consumers replace the settled figure, never sum the pair

    @unit
    Scenario: A settled event never matches a completed-only subscription
      Given an endpoint subscribed only to completed events
      Then settled events do not match it
      And family and match-all subscriptions receive both

    @integration
    Scenario: A completed-only subscription never receives settlements
      Given one endpoint on the completed type and one on the gateway family
      When a settlement is delivered
      Then only the family-subscribed endpoint gets a send

  Rule: Deliveries are signed and attributable

    @unit
    Scenario: Every delivery carries a verifiable signature
      Given a signing secret and a request body
      When the payload is signed
      Then the signature header carries the timestamp and an hmac
      And the reference verifier accepts it

    @unit
    Scenario: A tampered body fails verification
      Given a signed payload
      When the body is altered after signing
      Then the reference verifier rejects it

    @unit
    Scenario: A stale signature outside the tolerance window is rejected
      Given a payload signed eleven minutes ago
      Then the reference verifier rejects it as stale

    @unit
    Scenario: The envelope renames the provider column to the contract field
      Given a spend record carrying a provider key
      When it is mapped to its envelope
      Then the payload field is named model provider id
      And the envelope id is the gateway request id

  Rule: Retries follow the Stripe ladder and respect the receiver

    @unit
    Scenario: The retry ladder holds its last attempt inside seventy two hours
      Given the ladder delays and the send attempt budget
      Then the cumulative schedule stays within seventy two hours of the first failure
      And the cadence settles at twelve hours

    @unit
    Scenario: A permanent receiver error retires the batch immediately
      Given a delivery attempt that failed with a non-retryable error
      When the dispatcher classifies it
      Then the message is dead lettered on that attempt instead of burning the ladder

    @integration
    Scenario: The receiver's status code is stored on every attempt
      Given a receiver that answers with a server error
      When a batch delivery attempt runs
      Then a delivery row records the receiver's status and latency

  Rule: Dead endpoints disable themselves, recovery is explicit

    @integration
    Scenario: Seventy two hours of consecutive failures disables the endpoint
      Given an endpoint whose failure streak started more than seventy two hours ago
      When another delivery attempt fails
      Then the endpoint is disabled with the automatic reason
      And the auto disable notification hook fires

    @integration
    Scenario: A success resets the failure streak
      Given an endpoint with a failure streak in progress
      When a delivery attempt succeeds
      Then the streak is cleared

    @integration
    Scenario: A disabled endpoint drains its queue without posting
      Given a disabled endpoint with a pending batch
      When the batch dispatches
      Then nothing is sent to the receiver
      And the batch completes so the queue drains

    @integration
    Scenario: Dead lettered batches can be requeued
      Given a dead outbox message for an endpoint
      When the operator requeues that endpoint's dead messages
      Then the message is pending again with a fresh attempt budget

  Rule: Secrets are shown once and the platform is enterprise gated

    @integration
    Scenario: The signing secret is returned only at create and roll time
      When an endpoint is created
      Then the response carries the secret once
      And no read surface returns it again

    @integration
    Scenario: Without the plan flag the surface refuses politely
      Given an organization whose plan lacks webhook endpoints
      When it calls the webhook endpoints api
      Then the request is rejected as an enterprise feature

  Rule: The emitted events log is the primitive, webhooks ride it

    @integration
    Scenario: The events listing pages the organization's emitted events
      Given spend records across the organization's projects
      When the events log is read with a page limit
      Then envelopes come back newest first with a continuation cursor

    @integration
    Scenario: The events listing serves settlements under their own type and hides in-flight rows
      Given a settled record and an admitted record
      When the events log is read
      Then the settled record appears as its own event type with its reason
      And the admitted record never appears
      And filtering by an unknown type yields an empty page

    @integration
    Scenario: Each endpoint retries independently on its own ladder
      Given two endpoints where one receiver is down
      When a spend event is delivered
      Then the healthy endpoint's send succeeds
      And only the dead endpoint's message retries
