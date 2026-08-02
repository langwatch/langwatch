Feature: Billing spend events, one durable record per gateway request
  The spend record is projected from the gateway's own commands, not from
  telemetry: every request is admitted before any gating runs, its outcome
  is confirmed or failed with integer quantities and the full error
  taxonomy, and a confirmation that never arrives is settled visibly
  instead of dropped. Rating happens in the pipeline as integer nano-USD,
  so a price correction is a projection rebuild, never a correction stream.
  Commands leave the pod through a bounded fsync'd spool, so the request
  path never waits on the ingest endpoint and a crash loses at most the
  unflushed tail.

  Background:
    Given a virtual key serving traffic through the gateway

  Rule: Every request is a record, before and regardless of its outcome

    @unit
    Scenario: Every request admits a spend record before any gating runs
      When a request enters the gateway pipeline
      Then an admit command is emitted before budget or guardrail gating
      And its attribution is already resolved

    @unit
    Scenario: A gateway rejection admits and fails with its own taxonomy token
      Given a request a budget or guardrail rejects
      When the gateway refuses it
      Then the admitted record is failed with the gateway's taxonomy token
      And the rejection is a visible record, not a missing one

    @unit
    Scenario: A provider failure classifies through the upstream taxonomy
      Given a provider that answers with an error
      When the gateway fails the request
      Then the fail command carries the full error class and http status

    @unit
    Scenario: A streaming request confirms once with the accumulated usage
      Given a streaming response consumed to its end
      Then exactly one confirm command carries the accumulated token classes

    @unit
    Scenario: A client disconnect mid-stream confirms the tokens consumed so far
      Given a client that drops the stream midway
      Then the confirm command carries the usage accumulated to the drop

    @unit
    Scenario: A stream that dies mid-flight fails with the accumulated usage
      Given a provider stream that errors midway
      Then the fail command carries the partial usage consumed before the error

    @unit
    Scenario: The header-resolved end user beats the body param
      Given a request carrying both the end user header and a body user param
      When the gateway resolves attribution at admission
      Then the admit command carries the header value

    @unit
    Scenario: Outcome duration measures the request, not the emission
      When an outcome command is emitted asynchronously
      Then its duration is the provider round trip, never the spool latency

  Rule: The spool survives what the pod does

    @unit
    Scenario: Appended records seal within a flush interval and read back in order
      When commands are appended to the spool
      Then they are fsync sealed within the flush interval
      And read back in append order

    @unit
    Scenario: Sequence numbers continue across a clean restart
      Given a pod that restarts cleanly
      Then per-pod sequence numbers continue instead of resetting
      And the gap detector sees no false hole

    @unit
    Scenario: A hard crash preserves flushed records and skips a torn last line
      Given a pod killed mid-append
      When the spool reopens
      Then every sealed record survives
      And the torn tail line is skipped, not misparsed

    @unit
    Scenario: Overflow drops the oldest segments and counts every lost record
      Given a spool at its size bound with the drainer down
      When new commands keep arriving
      Then the oldest segments are dropped first
      And every dropped record increments the loss counter

    @unit
    Scenario: Appends never block even when the writer is gone
      Given the spool writer has died
      Then request-path appends still return immediately

    @unit
    Scenario: The drainer ships oldest first and deletes only after ack
      Given sealed segments waiting in the spool
      Then batches ship oldest first
      And a segment is deleted only after the ingest acked it

    @unit
    Scenario: Ship failures back off and never touch the spooled data
      Given an ingest endpoint that errors
      Then the drainer backs off and retries
      And the spooled segments are left intact

    @unit
    Scenario: A hung ingest endpoint never slows the request path
      Given an ingest endpoint that hangs
      Then request latency is unaffected
      And the spool absorbs the backlog

  Rule: The wire contract is the spine's

    @unit
    Scenario: The admitted payload carries the spine contract field names
      When an admit command is serialized for the ingest route
      Then its field names match the spend pipeline's command schema exactly

    @unit
    Scenario: The confirmed payload carries usage by token class and never a cost
      When a confirm command is serialized
      Then it carries integer token quantities and the rate identity
      And no cost field exists anywhere in it

    @unit
    Scenario: The failed payload keeps the full error taxonomy
      When a fail command is serialized
      Then the error class and http status ride verbatim

    @unit
    Scenario: A shipped batch is signed with the shared gateway HMAC scheme
      When the drainer ships a command batch
      Then the request is signed with the gateway's shared HMAC scheme

  Rule: The fold is the spend record

    @unit
    Scenario: The admit command carries attribution into the spend record
      When an admitted event folds
      Then the record carries the attribution, the end user id, and the echo verbatim

    @unit
    Scenario: The fold records the price the outcome carried
      When a confirmed event folds
      Then the record states the integer nano-USD the event was appended with
      And the rate identity that produced that figure

    @unit
    Scenario: The price is fixed when the outcome is recorded and every surface repeats it
      Given an outcome priced once when its command was appended
      When the model catalog changes before the other consumers run
      Then the spend record, the budget debit, and the webhook envelope state the same cost
      # Three consumers read this event independently and at different
      # instants, so pricing per consumer would let them disagree about
      # what one request cost.

    @unit
    Scenario: A redelivered event re-sets the same values
      Given a confirmed event the fold already applied
      When the same event is delivered again
      Then every field re-sets to the identical value
      And nothing increments

    @unit
    Scenario: Settlement marks the unknown instead of guessing
      Given an admission whose confirmation never arrived
      When the settlement event folds
      Then the record is settled with null quantities
      And it is flagged for reconciliation with its reason

    @unit
    Scenario: A late confirmation resolves a settled request
      Given a request already settled as unknown
      When its confirmation finally folds
      Then the record is confirmed and the reconciliation flag clears

    @unit
    Scenario: A confirmed request never downgrades
      Given a confirmed record
      When a failed or settled event is redelivered after it
      Then the record is unchanged

    @unit
    Scenario: An outcome racing ahead of its admission keeps its status
      Given a confirmation that arrived before its admission
      When the admission folds afterwards
      Then the status stays confirmed and the attribution fills in

    @unit
    Scenario: A settled request is its own event type with unknown cost
      Given a settled spend record
      When it is mapped to its wire envelope
      Then the type is settled with null cost and null usage
      And the completed stream never carries it

    @unit
    Scenario: Partial usage on a failure still prices
      Given a failure that consumed tokens before it broke
      When the failed event folds
      Then the record carries the integer nano-USD its partial usage priced at

  Rule: The table is a billing ledger, not observability data

    @unit
    Scenario: Billing records are exempt from tenant retention and keep a fixed thirteen month window
      Given a tenant retention policy of thirty five days
      Then gateway spend events are not governed by it
      And the table's own retention is a fixed thirteen month delete

  Rule: Silence settles, and settlement is never the last word

    @integration
    Scenario: An unconfirmed admission settles when the grace expires
      Given an admitted request whose confirmation never arrives
      When the settlement grace elapses
      Then the sweeper issues settleSpend for that request

    @integration
    Scenario: A confirmation inside the grace stands the sweeper down
      Given an admitted request
      When its confirmation arrives inside the grace
      Then the armed settlement wake is cleared and nothing settles

    @integration
    Scenario: An outcome racing ahead of its admission arms no wake
      Given a confirmation that arrived before its admission
      Then the late admission arms no settlement wake

    @integration
    Scenario: Duplicate wakes cannot double-settle
      Given a settlement wake that already fired
      Then a duplicate wake issues no second settle

    @integration
    Scenario: The full settlement sequence: silent admission settles, a late confirmation supersedes
      Given an admission folded to the spend record with no outcome
      When the sweeper settles it and a late confirmation then arrives
      Then the settled row carries unknown cost and needs reconciliation
      And the confirmation replaces it with the rated record and the completed envelope

  Rule: Replay re-delivers, the consumer's dedup decides

    @integration
    Scenario: Replay re-delivers a window's envelopes to one endpoint through the delivery path
      Given emitted spend envelopes in a window
      When the window is replayed to one endpoint
      Then matching envelopes ride the normal delivery stream with unchanged ids
      And an inverted or over-wide window is refused

  Rule: The pull surface serves the ledger, in-flight rows included

    @unit
    Scenario: The pull surface serves in-flight rows as admitted envelopes
      Given a spend row that has been admitted but has no outcome yet
      When the row is mapped for the pull surface
      Then the envelope type is admitted with usage, cost, and duration null
      And that type never appears on the push stream

  Rule: Summaries are the reconciliation checksum

    @integration
    Scenario: Per key summaries roll up priced outcomes with settled counted separately
      Given priced and settled spend records across keys and end users
      When the spend summaries are read grouped by a key
      Then each row sums tokens and integer nano cost over priced outcomes only
      And settled requests appear as their own count, never in the cost

  Rule: The caller declares who spent it

    @unit
    Scenario: A header-declared end user wins over the body user param
      Given a request carrying both an x-langwatch-end-user-id header and a body user param
      When the gateway stamps the customer span
      Then the span's end user id is the header value

    @unit
    Scenario: The OpenAI user body param attributes the request when no header is sent
      Given a chat request whose body carries a user param and no attribution header
      When the gateway stamps the customer span
      Then the span's end user id is the body user param

    @unit
    Scenario: Request shapes without a user param stamp nothing without a header
      Given an Anthropic-wire request with no attribution header
      When the gateway stamps the customer span
      Then no end user id is inferred from its body

    @unit
    Scenario: A request with no end user carries no attribution attribute
      When a request arrives with no attribution header and no user param
      Then the customer span carries no end user id attribute

    @unit
    Scenario: The body user param is sanitized like the headers
      Given a user param carrying control characters and padding
      When the gateway stamps the customer span
      Then the stamped id is trimmed, control-stripped and capped

    @unit
    Scenario: Attribution headers are consumed by the gateway, never forwarded
      Given a request carrying attribution and metadata headers
      When the gateway forwards the request upstream
      Then none of those headers survive on the forwarded request
      And the body user param passes through unchanged

  Rule: The metadata echo is a join key, not a payload channel

    @unit
    Scenario: The metadata echo is stamped verbatim on the customer span
      Given a request with a valid x-langwatch-metadata JSON object
      When the gateway stamps the customer span
      Then the reserved metadata attribute carries the object verbatim

    @unit
    Scenario: No metadata header means no reserved metadata attribute
      When a request arrives without a metadata header
      Then the customer span carries no reserved metadata attribute

    @unit
    Scenario: An invalid metadata echo is dropped without failing the request
      Given a metadata header that is oversized or not a JSON object
      When the gateway processes the request
      Then the echo is dropped and the request proceeds
