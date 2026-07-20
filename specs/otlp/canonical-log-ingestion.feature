Feature: Canonical OTLP log ingestion

  Logs sent over OTLP are stored with their structure intact: the body keeps its
  shape and type, and resource, scope and record attributes stay distinguishable
  from one another.

  A log record is identified by its own content, so a redelivered batch does not
  duplicate it or bill twice. Tying a record to a trace is best-effort and
  separate from accepting it.

  See ADR-055 for the architectural decisions behind this.

  Background:
    Given a project that accepts OTLP logs

  Rule: Log structure survives ingestion

    Scenario: A structured body keeps its shape
      When the project sends a log record whose body is a structured value
      Then the stored record preserves that structure
      And it is not flattened to a plain string

    Scenario: Attribute scopes stay distinct
      When the project sends a log record carrying resource, scope and record
        attributes that share a key name
      Then each set is still readable separately

    Scenario: Severity keeps both its number and its text
      When the project sends a log record with a severity number and text
      Then the stored record reports both

  Rule: The server never tells a client to discard data the server is holding

    Scenario: Storage trouble asks the client to retry
      Given the platform cannot durably store incoming records
      When the project sends a valid batch
      Then the response tells the client the request is retryable
      And the response does not report the records as rejected
      And the response does not disclose internal failure detail

    Scenario: A record that cannot be tied to a trace is still accepted
      Given a log record correlates to a span the platform cannot resolve
      When the project sends it
      Then the record is accepted
      And the response does not report it as rejected

    Scenario: Only the sender's own malformed records count as rejected
      When the project sends a batch containing a malformed record alongside
        valid ones
      Then the response reports only the malformed record as rejected
      And the valid records are accepted

  Rule: Redelivery is safe

    Scenario: The same batch sent twice is stored once
      Given a batch of log records has already been accepted
      When the sender delivers the same batch again
      Then the records are stored once
      And usage is counted once

  Rule: Useful agent logs reach the trace they belong to

    Scenario: Coding agent logs enrich their trace
      Given a log record carries recognised coding-agent detail
      And it correlates to a known span
      When the project sends it
      Then that detail is available on the trace
      And the record remains readable in its own right

  Rule: Upgrades do not lose logs in flight

    Scenario: Logs sent by an instance mid-upgrade are still stored
      Given an instance running the previous release sends a log record
      When a newly deployed instance processes it
      Then the record is stored and remains readable
