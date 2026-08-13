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

    @integration
    Scenario: An outcome that outruns its admission is delivered once admission arrives
      Given a confirmation consumed before the admission it belongs to
      When the admission arrives afterwards
      Then exactly one envelope is delivered, carrying the admission attribution
      And a real outcome held this way is never displaced by a later settlement
      # The envelope needs attribution only admission carries, so the outcome
      # waits rather than shipping an unattributed row or none at all.

  Rule: Receiver URLs are https unless the operator opts in

    @integration
    Scenario: Plain-http receiver URLs need the operator opt-in
      Given the deployment did not set the unsafe local-URLs flag
      Then creating an endpoint with an http URL is refused
      And with the flag set the same endpoint is accepted

  Rule: An endpoint delivers over HTTP or to an Amazon SQS queue

    # The delivery machinery is one machinery: the same batching, the same
    # ladder, the same delivery log, the same signature. Only the last hop
    # differs, so the transport is what varies and everything above it does
    # not know which one it got.

    @unit
    Scenario: The transport answers with a verdict, not a status
      Given a delivery transport
      When a batch is handed to it
      Then it answers success, retryable or terminal
      And a queue answers with no status at all
      # The recorder used to re-derive the verdict from an HTTP status. A
      # queue has no status, so the transport classifies and the recorder
      # trusts it.

    @unit
    Scenario: The HTTP transport classifies exactly as the sender always did
      Given the HTTP transport
      Then a 2xx answer is success
      And 500, 429 and 408 are retryable
      And every other status, redirects included, is terminal

    @integration
    Scenario: An HTTP endpoint delivers unchanged through the transport seam
      Given an endpoint with no destination kind stored
      When a batch is delivered
      Then it is posted exactly as before, to the same URL with the same headers
      And its delivery log rows are indistinguishable from the ones it recorded before

    @integration
    Scenario: Both destinations answer to the same hourly dispatch cap
      Given an organization at its hourly dispatch cap
      When a batch is delivered to a queue destination
      Then it is refused as retryable with a back-off
      # The cap used to live inside the HTTP sender, so a queue destination
      # would have been uncapped.

    @unit
    Scenario: A queue message carries the same bytes as the HTTP body
      Given a batch of envelopes
      When it is delivered to a queue
      Then the message body is byte-identical to the body the HTTP transport would post
      And no outer wrapper is added around it
      # The same bytes means the same signature verifier and the same golden
      # vectors on the receiving side.

    @unit
    Scenario: Signature, delivery id and attempt ride as message attributes
      Given a signed batch delivered to a queue
      Then the signature travels under the same name as its HTTP header
      And so do the delivery id and the delivery attempt
      # A consumer sees no attributes at all unless it asks for them by
      # passing MessageAttributeNames: ["All"] to ReceiveMessage.

    @unit
    Scenario: A batch too large for one queue message is refused terminally
      Given a batch whose body and attributes exceed the queue message limit
      When it is delivered
      Then the verdict is terminal
      And the refusal names the batch-size control as the way to fix it
      # Retrying is pointless: the same bytes will never fit. Splitting is
      # not available either, because one batch is one message and its id is
      # the replay-safety key.

    @integration
    Scenario: A FIFO queue is refused at save time
      When an endpoint is saved with a queue URL ending in .fifo
      Then the response status is 400
      And error.code = "webhook_endpoint_invalid"
      And the refusal says standard queues only
      # Our contract is at-least-once with envelope-id dedup, which is what a
      # standard queue is; we never promised ordering, and FIFO caps at 300
      # per second.

    @integration
    Scenario: A queue URL outside the canonical Amazon SQS shape is refused
      When an endpoint is saved with a queue URL that is not an Amazon SQS queue URL
      Then the response status is 400
      And error.code = "webhook_endpoint_invalid"
      # The SSRF fence never sees this URL, because the AWS SDK dials it, so
      # the shape is pinned instead.

    @unit
    Scenario: The region and the account come from the queue URL
      Given a canonical Amazon SQS queue URL
      Then its region is read off the URL rather than configured separately
      And its account id is surfaced so an operator can see whose queue it is

    @integration
    Scenario: Ambient AWS credentials need the operator opt-in
      Given the deployment did not set the unsafe ambient-credentials flag
      Then saving a queue endpoint with no credentials of its own is refused
      And with the flag set the same endpoint is accepted
      # Without the gate a customer could name any queue the deployment's own
      # role can write to.

    @integration
    Scenario: Static queue credentials are stored encrypted and never echoed
      When an endpoint is saved with a static access key and secret
      Then the secret is encrypted at rest
      And no read of the endpoint returns it

    @unit
    Scenario: A missing or forbidden queue is terminal, a throttled one retries
      Given a queue delivery that failed
      Then a missing queue or a refused permission is terminal
      And throttling, a server error and a network failure are retryable
      And an expired credential is retryable

    @integration
    Scenario: Saving an endpoint names the field its destination kind is missing
      When an endpoint of a kind is saved without the field that kind requires
      Then the response status is 400
      And the refusal names the missing field rather than the whole body

    @integration
    Scenario: An endpoint never changes its destination kind
      Given an endpoint that delivers over HTTP
      When an update asks for the queue kind
      Then the response status is 400
      And error.code = "webhook_endpoint_invalid"
      # Messages already planned against the old transport are in flight in
      # the outbox.

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
    Scenario: During a secret rotation a delivery verifies under either secret
      Given an endpoint whose secret was rolled inside the grace window
      When a delivery is signed
      Then the header carries one v1 per valid secret, newest first
      And the reference verifier accepts a match against any of them
      # v1 REPEATS. A receiver that reads only the first one rejects every
      # delivery signed during a rotation.

    @integration
    Scenario: A rolled secret keeps signing for a grace window
      Given a signing secret that was just rolled
      When the endpoint's signing secrets are read inside the window
      Then both the new and the previous secret are returned, newest first
      And after the window only the new secret is returned
      # Overwriting in place made every roll a coordinated deploy, and 72h
      # of the resulting failures auto-disables the endpoint.

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
    Scenario: The in-flight cap is the endpoint's own, across every project
      Given an endpoint capped at one in-flight send with a slow receiver
      When a second project in the same organization sends to it
      Then its envelope waits in the endpoint's one buffer
      And no second POST opens against the receiver
      # Endpoints belong to the organization, so a cap kept per project
      # would let N projects hold N sends open against one receiver.

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
      Given a key that is created, rotated, disabled, enabled, and revoked
      When each change's envelope is built
      Then each carries its lifecycle type with a deterministic id
      And the reason travels on a disable
      # Rotation included: consumers watching credentials hear about the
      # grace window starting, same seam as every other lifecycle exit.

    @unit
    Scenario: A budget crossing becomes a threshold or breach envelope
      Given a bucket that crossed its warn threshold and one that reached its limit
      When each crossing's envelope is built
      Then one is the threshold family and the other the breach family
      And both carry the bucket, the window, the period, and both figures

    @unit
    Scenario: Budget events name the key and project they belong to
      Given a crossing on a budget that targets a virtual key
      When its envelope is built
      Then the payload carries virtual_key_id and anchor_project_id as their own fields
      # bucket_scope_id only holds the key as the prefix of a composite, and
      # that composite cannot be split when an end user id contains a colon.

    @unit
    Scenario: Every enum on the webhook payload is lowercase snake
      Given a crossing whose stored values carry the database's own casing
      When its envelope is built
      Then scope_type, window, and on_breach are all lowercase snake
      # Converted at the envelope seam, so replayed events emit the wire
      # casing too rather than whatever the store happened to hold.

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
    Scenario: Load more appends the next page below the loaded rows
      Given a loaded first page and a second page behind its cursor
      When the load-more control is used
      Then both pages' rows are visible together
      And rows the reader already scanned keep their position

    @integration
    Scenario: No Load more when the page is the last
      Given a deliveries page with no next cursor
      Then no load-more control is shown

    @unit
    Scenario: Webhook management is an organization-scoped permission
      Given a user with an organization admin role
      Then the webhook and spend permissions resolve against the org role

  Rule: The events log serves what it says it serves

    # The request families are reconstructable from the spend ledger, which
    # carries a 13-month retention contract. The governance families are
    # delivered exactly like them but nothing retains the envelope in a
    # queryable form, so the log says so instead of implying a transient gap.

    @integration
    Scenario: An event id the log cannot answer for is a canonical 404
      When an event is read by an id this organization's log does not hold
      Then the response status is 404
      And error.code = "webhook_event_not_found"
      And the refusal does not say which of the three reasons applies

    @integration
    Scenario: A malformed event id is refused the same way as a missing one
      When an event is read by an id naming no event the log ever minted
      Then the response status is 404
      And an id naming an admitted row is refused too, being an in-flight request

    @integration
    Scenario: The governance families are absent from the log, not merely empty by chance
      When the log is filtered to a budget or virtual-key event type
      Then the page is empty and its next cursor is null
      And the route documents that the log does not retain those families

    # The log is a read over the same 13-month spend table the reconciliation
    # pull reads, so the created range is part of the contract rather than a
    # filter: unbounded, a single page sorts every month the organization has,
    # cold storage included.

    @integration
    Scenario: The events log refuses a read with no created range
      When the log is read with neither bound, or with only one of them
      Then the response status is 400
      And error.code = "validation_error"
      And the refusal names the bound that is missing

    @integration
    Scenario: The events log refuses an inverted created range
      When the log is read with a range that ends before it starts
      Then the response status is 400
      And error.code = "validation_error"
