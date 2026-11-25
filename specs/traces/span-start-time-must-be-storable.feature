# The past edge of a span's start time is bounded at ingestion (31 days, see
# `SPAN_MAX_PAST_MS`). Nothing bounded the future edge, and
# `specs/traces/trace-summary-storage-anchor.feature` covers only where such a
# trace is FILED, not whether its span can be stored at all.
Feature: A span is only accepted when its own times can be stored

  A span carries the time it started and the time it ended. Both are the
  producer's own numbers, and a producer can send anything: a client that scales
  milliseconds into nanoseconds one time too many sends a start time wrong by
  six orders of magnitude.

  Such a span cannot be stored. Its start time is past the last instant span
  storage can represent, and the identity a stored span is filed under carries
  that start time in a field far too small to hold it. Refusing it late — once
  the span is already recorded and being read back for storage — is worse than
  refusing it early: the failure is permanent, but it is retried, and the
  retries hold up every other span the same project sent.

  So the same question is asked at both ends. At the door, a span whose times
  cannot be stored is rejected and the sender is told. Behind the door, a span
  already recorded with such a time is passed over, and the project's other
  spans carry on.

  Background:
    Given a project sending spans to LangWatch

  Rule: A span whose times cannot be stored is refused at the door

    @unit
    Scenario: A span whose start time cannot be stored is rejected at ingestion
      Given a span whose start time is far beyond any instant storage can hold
      When the span is sent
      Then the span is not recorded
      And the response reports it as rejected, saying its start time is not a valid timestamp
      And the other spans in the same batch are recorded as usual

    @unit
    Scenario: A span starting far in the future is still accepted when storage can hold it
      Given a span reporting a start time decades ahead of today
      When the span is sent
      Then the span is recorded
      # A clock years out is a real shape, and one already handled: where such a
      # trace is filed is decided separately. Only what cannot be stored at all
      # is refused here.

  Rule: A span already recorded with an unstorable time never blocks the rest

    @unit
    Scenario: A stored span whose start time cannot be stored is skipped without blocking the rest of the project's spans
      Given a span was recorded before the door refused such times
      When the span is read back to be stored, counted and summarised
      Then it is passed over everywhere rather than failing
      And an operator sees one warning naming the project, the trace, the span and the time it reported
      And another span on the same trace is still stored and still sets the trace's timing
