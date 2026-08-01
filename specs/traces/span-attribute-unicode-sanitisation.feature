Feature: Malformed unicode in a span never permanently fails ClickHouse ingest
  As an operator running the LangWatch trace-ingest pipeline
  I want a span that contains a lone (unpaired) UTF-16 surrogate half to still be
  stored
  So that a single garbage character in one span can never dead-letter a whole
  batch of spans and lose them forever

  # =========================================================================
  # Why this exists
  # =========================================================================
  #
  # Span attribute values (and other free-text span strings) are serialised into
  # ClickHouse Map(String, String) / String columns and inserted with
  # `format: JSONEachRow`. JS strings are UTF-16 and can carry a lone surrogate
  # half (`\uD800`–`\uDFFF` with no matching pair) — for example a value
  # truncated mid-emoji, or binary / garbage text an SDK captured as a string.
  #
  # `JSONEachRow` serialises such a half as a `\uD800`-style escape with no
  # second part. By default ClickHouse's JSON parser rejects it with:
  #
  #   Cannot parse escape sequence: missing second part of surrogate pair.
  #   ... (while reading the value of key SpanAttributes) ...
  #
  # The insert throws, the pipeline retries, retries exhaust, and the span is
  # dead-lettered. In production this dead-lettered 13 groups for one project on
  # a single bad character.
  #
  # The fix sets `input_format_json_throw_on_bad_escape_sequence: 0` on the span
  # insert — exactly what ClickHouse's own error message recommends. ClickHouse
  # then keeps the bad escape sequence as text instead of throwing, so the span
  # is stored. This is handled once, at the insert boundary, per batch and O(1),
  # rather than walking and rewriting every string of every span (attribute
  # keys/values, names, statuses, event names — an unbounded per-span payload) on
  # the hot ingest path just to pre-empt the parser. Valid strings are never
  # touched; only the rare malformed one is stored verbatim.
  # =========================================================================

  Background:
    Given a span is being written to the ClickHouse span store

  Rule: A span carrying a lone surrogate is stored, not dead-lettered

    Scenario: An attribute value truncated mid-emoji does not fail the insert
      Given a span attribute value that ends in a lone UTF-16 surrogate
      When the span is inserted into the ClickHouse span store
      Then the insert is accepted instead of throwing a surrogate-pair error
      And the span can be read back instead of being lost to the dead-letter queue

    Scenario: Lone surrogates anywhere on the span cannot fail the insert
      Given a span whose name, status message, scope name and version, event
        names, and event / resource / span attribute keys and values each
        contain a lone UTF-16 surrogate
      When the span is inserted into the ClickHouse span store
      Then the insert is accepted for the whole batch
      And the span reads back with its valid data untouched
