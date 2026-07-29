Feature: Billing spend events, one unconditional record per gateway request
  The budget ledger exists for enforcement and only gets rows when a budget
  applies. Billing is different: every gateway request must be metered,
  budget or no budget, at per-request grain, with token classes split out,
  the rated cost, attribution, and a stable idempotency key. The trace fold
  keeps one bookkeeping entry per gateway span so requests survive being
  folded under a shared client traceparent, and a dedicated reactor writes
  them to their own table, exempt from tenant retention.

  Background:
    Given a virtual key serving traffic through the gateway

  Rule: Every request is metered, independently of budgets

    @unit
    Scenario: A gateway request is metered even when its key has no budget
      Given the key has no applicable budgets
      When a request folds into the trace summary
      Then a spend record exists for that request
      And no budget debit row is written

    @unit
    Scenario: Budget debits stay budget-gated while spend records never are
      Given the key has one applicable budget
      When a request folds into the trace summary
      Then a budget debit row is written for that budget
      And the spend record for the request exists regardless

  Rule: Grain is per request, never per trace

    @unit
    Scenario: N requests under one client traceparent produce N spend records
      Given a client that reuses one traceparent across three gateway calls
      When the three spans fold into one trace
      Then three spend records exist, each under its own gateway request id

    @integration
    Scenario: Re-folding a trace does not duplicate spend records
      When the same trace folds twice
      Then each gateway request still has exactly one spend record

    @unit
    Scenario: Entry-less legacy folds still meter as one whole-trace record
      Given a trace folded before per-request bookkeeping existed
      When the reactors process it
      Then one spend record exists under the first request id
      And it carries the whole-trace totals

  Rule: The record carries what billing actually prices

    @unit
    Scenario: Cache read and cache write tokens are metered with real values
      Given a request whose response reports cache read and cache write tokens
      When it folds
      Then the spend record and the budget debit both carry those token counts

    @unit
    Scenario: The provider id rides the spend record when the span carries it
      Given a gateway span stamped with a model provider id
      When it folds
      Then the spend record carries that provider id

    @unit
    Scenario: A failed request keeps its rich error class and http status
      Given a request that failed upstream with a classified error
      When it folds
      Then the spend record status is error
      And it carries the error class and the upstream http status

    @unit
    Scenario: Spend records anchor to request time, not ingest time
      When a request folds long after it happened
      Then the spend record's occurred-at is the request's own start time

  Rule: The table is a billing ledger, not observability data

    @integration
    Scenario: Spend reads are replacement-aware
      Given the same spend record was written twice by at-least-once delivery
      When the reconciliation read runs
      Then it returns the record exactly once

    @unit
    Scenario: Billing records are exempt from tenant retention and keep a fixed thirteen month window
      Given a tenant retention policy of thirty five days
      Then gateway spend events are not governed by it
      And the table's own retention is a fixed thirteen month delete

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

    @unit
    Scenario: The end user id and metadata echo ride the entry into billing
      Given a request attributed to an end user with a metadata echo
      When it folds into a spend record
      Then the record carries the end user id and the echo verbatim

    @unit
    Scenario: Entries stored before the metadata field existed still parse
      Given a fold entry persisted before the metadata echo shipped
      When the entry list is parsed
      Then the entry parses with an empty echo

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
      Then the echo is dropped and the request succeeds
