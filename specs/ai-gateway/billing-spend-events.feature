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
    Scenario: The confirm command carries every billable quantity, not only token classes
      Given a request a provider bills by characters, seconds, or audio tokens
      When the gateway confirms it
      Then the payload carries that quantity beside the token classes
      And audio tokens are stated apart from the text totals they came out of
      And a text-only request carries the same token counts it always did

    # A provider reports one prompt total that already holds the tokens it
    # served from its cache. The rating seam prices the cache buckets on top of
    # the input bucket, so a total shipped whole charges every cached token
    # twice: once at the input rate and once at its own. On a model whose cache
    # read costs a tenth of its input, that is eleven times the published rate.
    # The customer span already states the split; the spend record has to state
    # the same one or a trace and its bill disagree.

    @unit
    Scenario: The confirm command states the cached tokens apart from the input it charges at the input rate
      Given a request whose prompt was mostly served from the provider's cache
      When the gateway confirms it
      Then the input token count is the non-cached remainder
      And the cache-read and cache-write counts travel beside it
      And a request with no cache activity carries the full prompt as input
      And the count matches the one the customer span reports

    @unit
    Scenario: A quantity added to the vocabulary defaults on records written before it
      Given a confirmation recorded before a quantity existed
      When it is read back
      Then the missing quantity reads as zero
      And the record parses instead of failing

  Rule: A request the catalog cannot price says so

    A zero charge on a request that burned something is a catalog fault, and
    it looks exactly like a free request on the record. Rating is the only
    place both faults are visible: the model has no entry at all, or it has
    an entry that prices none of the quantities the request reported.

    @unit
    Scenario: A rule that prices none of the reported quantities is reported
      Given a model whose rate covers a quantity the request did not carry
      When the request rates at zero
      Then the model, the rate identity and the quantities it did carry are stated

    @unit
    Scenario: A model with no entry at all is reported
      Given a model the catalog does not carry
      When the request rates at zero
      Then the miss is stated once, not twice

    @unit
    Scenario: A request that measured nothing is not a fault
      Given a request that reported no quantity of any kind
      When it rates at zero
      Then nothing is reported, because zero is the right answer

    @unit
    Scenario: The failed payload keeps the full error taxonomy
      When a fail command is serialized
      Then the error class and http status ride verbatim

    @unit
    Scenario: A shipped batch is signed with the shared gateway HMAC scheme
      When the drainer ships a command batch
      Then the request is signed with the gateway's shared HMAC scheme

  Rule: A command the control plane accepted is never dropped in silence

    The ingest route answers 200 and the drainer deletes its spool segment, so
    from that moment the queued command is the only copy of the charge. A fleet
    mid-rollout runs two builds against one queue, and a worker on the older
    build has no handler for a pipeline the newer build just added.

    @unit
    Scenario: A worker without the spend pipeline refuses the command instead of acknowledging it
      Given a worker whose build does not register the gateway spend pipeline
      When a confirm command for that pipeline reaches it
      Then the command is rejected so another worker retries it
      And the rejection names the gateway request at error level

  Rule: Attribution the gateway cannot see is resolved once, at ingest

    The gateway knows the key and the project it dispatched for. The key's
    principal and the project's team live on control-plane rows it never
    reads, so the ingest seam joins them on the way in and the appended event
    carries them from then on. An event is immutable once appended, which is
    what makes the difference between a missing row and an unreachable
    database matter: one is a fact to record, the other is an unknown to
    retry.

    @integration
    Scenario: An admitted request carries the team and principal it debits
      Given a virtual key owned by a seat, in a project belonging to a team
      When the gateway's admission for that key reaches the ingest route
      Then the appended admission carries the team and the principal
      And the whole batch resolved them in two reads, not two per record

    @integration
    Scenario: A key in constant use is not written on every request
      Given a key whose last use was recorded moments ago
      When another batch of its admissions arrives
      Then its last-used timestamp is left alone
      And a key admitted after a long silence has its timestamp advanced

    @integration
    Scenario: A deleted key or a teamless project degrades one record, not the batch
      Given an admission naming a key deleted since it was dispatched
      When the batch reaches the ingest route
      Then that record appends with empty principal attribution
      And the ids it could not resolve are logged at error level
      And every other record in the batch keeps its full attribution

    @integration
    Scenario: An unreadable control plane retries the batch instead of guessing
      Given a control-plane database that cannot be read
      When a batch of admissions arrives
      Then the route fails the whole batch
      And nothing is appended with guessed attribution

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
    Scenario: An outcome states the attribution its admission has not delivered
      Given an outcome that carries its own attribution and no admission yet
      When it folds
      Then the record names the organization and the key from the outcome
      And a later admission still wins wherever it states a value
      # A brokered voice session is admitted by the gateway and confirmed by
      # the control plane. Two emitters on two paths means the confirmation
      # can fold first, and a priced row naming no organization is spend that
      # belongs to nobody.

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

  # WHY THE OUTCOME REPEATS THE ADMISSION'S ATTRIBUTION. The consumers that
  # act on an outcome — budget debits, webhook delivery — need to know who the
  # request belonged to, and only the admission used to say. So each of them
  # remembered every open admission in a durable row, one per gateway request,
  # in a table with no retention sweep (process-manager-retention.feature).
  #
  # The gateway already holds that attribution when it builds the outcome; it
  # simply was not repeating it. Repeating it lets both consumers act on the
  # one event they are handling and keep nothing, which is what makes their
  # evolutions transient (transient-process-instances.feature).
  #
  # ROLLING UPGRADE. The admission declares whether its emitter will repeat
  # attribution on the outcome, because the decision has to be made when the
  # admission is handled, before the outcome exists. Admission and outcome
  # always come from the same pod and the same build, so the pair is
  # self-consistent and the gateway and control plane may roll in either
  # order: an older build omits the flag and keeps the durable join.

  Rule: An outcome states the attribution it is billed against

    @unit
    Scenario: A confirmation carries the attribution its admission carried
      Given a gateway request admitted against an organization and virtual key
      When the gateway emits its confirmation
      Then the confirmation states the same organization, key, end user and trace

    @unit
    Scenario: A failure carries the attribution its admission carried
      Given a gateway request admitted against an organization and virtual key
      When the provider call fails
      Then the failure states the same organization and end user

    @unit
    Scenario: The outcome's attribution is the admission's, not a re-derivation
      Given a request whose end user was resolved at admission
      When the outcome is built after the body was materialized
      Then it states the end user the admission stated

    @integration
    Scenario: Ingest joins the control-plane attribution onto outcomes too
      Given a confirmation naming a virtual key
      When the spend command batch is ingested
      Then the confirmation carries the key's principal and the project's team

    @integration
    Scenario: An outcome from a build that carries no attribution is left alone
      Given a confirmation emitted without attribution
      When the spend command batch is ingested
      Then it is not enriched and the admission's remembered join is used

    # An outcome stashes itself when it states no attribution of its own, and
    # an admission that declares its outcomes self-describing writes no state
    # at all. The two conditions are not the same one: the first is about the
    # OUTCOME's data, the second about the build that sent it. Where they
    # disagree the admission is still the only place the scopes are known, so
    # it releases the stash rather than discarding it — dropping it would cost
    # the debit and strand the row holding it, which is the row this path
    # exists not to write.
    @unit
    Scenario: A self-describing admission still releases an outcome that stashed
      Given an outcome that stated no attribution and is waiting on its admission
      When an admission arrives declaring its outcomes carry attribution
      Then the waiting outcome is released against the admission's scopes
      And nothing is left waiting on that request

  Rule: Silence settles, and settlement is never the last word

    # The sweeper used to be one process instance per gateway request, each
    # holding a durable row and a wake armed at admission + grace. The join
    # those rows performed is already done by the fold, which leaves a request
    # at `admitted` until an outcome arrives, so "which requests are still
    # open" is a query rather than a memory. Settlement latency became grace
    # plus at most one sweep interval.

    @unit
    Scenario: An unconfirmed admission settles when the grace expires
      Given an admitted request whose confirmation never arrives
      When the settlement grace elapses
      Then the sweeper issues settleSpend for that request

    @unit
    Scenario: Settlement keeps one process instance for the install, not one per request
      Given several admissions open past their grace
      When the sweeper settles them
      Then exactly one settlement process instance exists

    @unit
    Scenario: The sweeper re-arms itself after every wake
      Given the settlement sweeper has run
      Then its next sweep is armed from the present

    @unit
    Scenario: One tenant's failed settle does not cost the rest of the sweep
      Given two admissions open past their grace and the first settle fails
      When the sweeper runs
      Then the second admission is still settled

    @unit
    Scenario: A sweep that finds nothing settles nothing
      Given no admission is open past its grace
      When the sweeper runs
      Then no settle command is sent

    @unit
    Scenario: A settled request names the organization it belonged to
      Given an admission the sweeper settles
      When the settle command is built from the spend record
      Then it carries the organization, key and end user the fold recorded

    @integration
    Scenario: The full settlement sequence: silent admission settles, a late confirmation supersedes
      Given an admission folded to the spend record with no outcome
      When the sweeper settles it and a late confirmation then arrives
      Then the settled row carries unknown cost and needs reconciliation
      And the confirmation replaces it with the rated record and the completed envelope

    # WHAT THE QUERY REPLACED. A cleared wake, a wake never armed, and a
    # duplicate wake used to be three behaviors of the durable per-request
    # row. They are now one behavior of the open-admission read: a request
    # the query no longer selects. The fold writes a version per lifecycle
    # transition, so a request that resolved still has its superseded
    # `admitted` version on disk, and a read that saw it would settle a live
    # request and ship a spurious settled envelope. These are stated against
    # real ClickHouse because that is the only place the collapse to the
    # latest version is real.

    @integration
    Scenario: A confirmation stands the sweeper down
      Given a request past its grace whose confirmation has arrived
      When the sweeper reads the open admissions
      Then the request is not among them, its superseded admission notwithstanding

    @integration
    Scenario: An admission inside its grace is not open yet
      Given an admission whose grace has not elapsed
      When the sweeper reads the open admissions
      Then the request is not among them

    @integration
    Scenario: A rewritten admission is offered once, not once per version
      Given an admission the fold rewrote before any outcome arrived
      When the sweeper reads the open admissions
      Then the request is offered exactly once

    @integration
    Scenario: A request that already reached a terminal status is never swept again
      Given a request that failed and a request already settled
      When the sweeper reads the open admissions
      Then neither is among them

    @integration
    Scenario: An admission older than the lookback is left where it is
      Given an admission older than the sweep's lookback
      When the sweeper reads the open admissions
      Then the request is not among them

    @integration
    Scenario: The sweep reads the oldest admissions first, up to its cap
      Given more open admissions than one sweep may settle
      When the sweeper reads the open admissions
      Then it receives the cap's worth, oldest first, and the newest is left for the next sweep

  Rule: Replay re-delivers, the consumer's dedup decides

    @integration
    Scenario: Replay re-delivers a window's envelopes to one endpoint through the delivery path
      Given emitted spend envelopes in a window
      When the window is replayed to one endpoint
      Then matching envelopes ride the normal delivery stream with unchanged ids
      And an inverted or over-wide window is refused

    @integration
    Scenario: An over-limit replay queues nothing
      Given a window holding more envelopes than one replay may carry
      When the window is replayed to one endpoint
      Then the call is refused before any envelope is queued
      And the endpoint has no buffered envelope and no send waiting
      # Replay reaches past the consumer's dedup window, so shipping part
      # of a window and then answering with an error double-delivers on
      # the retry.

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

    @integration
    Scenario: Summaries page by cursor instead of truncating at the limit
      Given more keys in the window than one page holds
      When the summaries are walked from the first page to the last
      Then a full page hands back a cursor and the final page hands back null
      And every key is served exactly once across the pages
      # A checksum that silently stopped at the limit read as a complete
      # reconciliation while missing keys entirely.

    @integration
    Scenario: Summaries accept the same virtual_key_id filter as the events pull
      Given spend records under two different virtual keys in one window
      When the summaries are read narrowed to one virtual key
      Then only that key's rows are rolled up

    @integration
    Scenario: A garbled summaries cursor is refused, not silently reset
      Given a cursor value this service never minted
      When the summaries are read with it
      Then the call is refused with the canonical error envelope
      # Silently restarting the walk would re-serve the whole window as if
      # it were the next page.

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

    @unit
    Scenario: The spend record's metadata echo holds to the ingest contract
      Given a metadata echo that parses as JSON but is not an object
      When the gateway records the spend
      Then the echo is dropped and the spend record still ships
