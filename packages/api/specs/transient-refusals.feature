# See dev/docs/ARCHITECTURE.md §8; rulings 2026-10-06 round 9 (CH-1) and round 7 (Q39).
Feature: Transient refusals keep their body, and JSON text is parsed at the door
  A 503 that says "wait and retry" for a reason the caller can act on keeps its code through
  the 5xx mask on REST and tRPC. Every other undeclared 5xx stays masked. A field that carries
  JSON text is parsed by the framework, so a malformed value is a schema issue, never a 500.

  Rule: A transient 503 refusal keeps its code, message and wait

    @integration
    Scenario: A ClickHouse overload answers 503 clickhouse_overloaded over REST
      Given a handler that throws the ClickHouse overload refusal at 503 with a wait in its meta
      When the REST boundary renders it
      Then the answer is 503 with code clickhouse_overloaded and its own message
      And it carries Retry-After from the wait

    @integration
    Scenario: A deployment with nothing behind a route answers 503 service_unavailable over REST
      Given a route whose capability this deployment composed nothing behind, such as an ingest with no recorder
      When the REST boundary renders the refusal
      Then the answer is 503 with code service_unavailable and its own message

    @unit
    Scenario: A transient refusal keeps its body over tRPC
      Given a procedure that throws clickhouse_overloaded or service_unavailable at 503
      When the tRPC error formatter renders it
      Then the message is the code and the serialized error carries its code, status and retryable flag

  Rule: Every other undeclared 5xx stays masked

    @integration
    Scenario: An undeclared 5xx outside the transient allowlist stays masked
      Given a platform 503 with another code, a transient code at 500, or a plain thrown Error
      When the REST boundary renders it
      Then the answer is the opaque internal_error body at the error's status, with no meta

    @unit
    Scenario: The transient allowlist is declared once
      Given the handled-error package
      When a boundary asks whether a handled error is a transient refusal
      Then only clickhouse_overloaded and service_unavailable at 503 answer yes

  Rule: A JSON-text field parses at the door

    @unit
    Scenario: A JSON-text field hands the handler the parsed value
      Given an input field declared as JSON text over a record schema
      When a caller sends a JSON object as text
      Then the handler receives the parsed record and the caller's input type stays a string

    @unit
    Scenario: A malformed JSON-text field is a 400 schema issue
      Given a procedure whose input declares a JSON-text field over a record schema
      When a caller sends text that is not JSON, or JSON that is not an object
      Then the input is refused as a schema issue, which tRPC answers 400 BAD_REQUEST
      And the handler is not reached

    @unit
    Scenario: A malformed graph JSON is a 400 schema issue
      Given the dashboard's graphs.create and graphs.updateById procedures, whose graph field is JSON text
      When a caller sends graph text that is not JSON, or JSON that is not an object
      Then the procedure answers 400 BAD_REQUEST with a schema issue on the graph field and stores nothing
      And a well-formed graph is stored and read back as the parsed record
