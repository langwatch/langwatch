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

  Rule: Receiver URLs are https unless the operator opts in

    @integration
    Scenario: Plain-http receiver URLs need the operator opt-in
      Given the deployment did not set the unsafe local-URLs flag
      Then creating an endpoint with an http URL is refused
      And with the flag set the same endpoint is accepted

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

  Rule: Delivery is tunable per endpoint, within server bounds

    @unit
    Scenario: Out of bounds delivery controls are rejected with the bound in the error
      When an endpoint is saved with a batch size past the server bound
      Then the save is rejected
      And the error names the allowed range

    @integration
    Scenario: Delivery controls are editable in the drawer within their bounds
      Given the endpoint drawer is open
      Then the batch size, batch delay, and in-flight controls show their defaults
      And saving sends the edited values

    @integration
    Scenario: Envelopes coalesce into one signed batch up to the endpoint's size
      Given an endpoint with a coalescing delay holding partial batches
      When enough events arrive to fill a batch
      Then one POST carries the full batch under a single signature
      And every envelope keeps its own event id

    @integration
    Scenario: A partial batch ships once its delay elapses
      Given buffered envelopes fewer than the batch size
      When the coalescing deadline passes
      Then the wake flushes them as one batch

    @integration
    Scenario: Under backpressure batches grow toward the size cap
      Given an endpoint capped at one in-flight send with a slow receiver
      When events keep arriving while the send retries
      Then they accumulate in the buffer instead of new POSTs
      And the next flush ships them as one larger batch

    @integration
    Scenario: The health report leads with the oldest undelivered age
      Given envelopes buffered and a send riding retries
      When the endpoint's health is read
      Then the oldest undelivered age reflects the stalest envelope
      And dead lettered batches are counted as DLQ depth

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

  Rule: Governance families ride the same platform

    @unit
    Scenario: Key lifecycle changes become their own envelope types
      Given a key that is created, disabled, enabled, and revoked
      When each change's envelope is built
      Then each carries its lifecycle type with a deterministic id
      And the reason travels on a disable

    @unit
    Scenario: A budget crossing becomes a threshold or breach envelope
      Given a bucket that crossed its warn threshold and one that reached its limit
      When each crossing's envelope is built
      Then one is the threshold family and the other the breach family
      And both carry the bucket, the window, the period, and both figures

    @unit
    Scenario: A crossing fires once per bucket per period
      Given the same bucket crosses its threshold twice inside one period
      When both crossings are appended
      Then the second append collapses on the store's idempotency key
      # (budget, bucket, kind, period) IS the once-per-crossing rule; a
      # new period mints a new key and fires again.

    @unit
    Scenario: Crossing detection reads the boundary-aware figure
      Given a bucket below the threshold, one above it, and one past the limit
      When post-debit detection runs
      Then only the above-threshold bucket appends a threshold crossing
      And only the past-limit bucket appends a breach
      And a detection failure never fails the debit that triggered it

    @unit
    Scenario: Governance events only reach endpoints subscribed to their types
      Given endpoints subscribed to spend events only, lifecycle events only, and the gateway family
      When a key lifecycle event is delivered
      Then the spend-only endpoint receives nothing
      And the lifecycle and family subscriptions receive it

  Rule: The delivery log is paginated and management is entitlement-gated

    @integration
    Scenario: The delivery log is cursor-paginated newest-first
      Given an endpoint with more deliveries than one page
      When the deliveries are read a page at a time
      Then each page is newest-first and the pages do not overlap

    @integration
    Scenario: The delivery log paginates with a Load more control
      Given a deliveries page that reports a next cursor
      Then a load-more control is shown

    @integration
    Scenario: The deliveries drawer loads more on demand
      Given a deliveries page that reports a next cursor
      Then a load-more control passes that cursor back for the next page

    @integration
    Scenario: No Load more when the page is the last
      Given a deliveries page with no next cursor
      Then no load-more control is shown

    @unit
    Scenario: Webhook management is an organization-scoped permission
      Given a user with an organization admin role
      Then the webhook and spend permissions resolve against the org role
