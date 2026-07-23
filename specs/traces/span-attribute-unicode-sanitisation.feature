Feature: Malformed unicode in a span never permanently fails ClickHouse ingest
  As an operator running the LangWatch trace-ingest pipeline
  I want span strings that contain lone (unpaired) UTF-16 surrogate halves to be
  sanitised at the ClickHouse write boundary
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
  # second part. ClickHouse's JSON parser rejects it with:
  #
  #   Cannot parse escape sequence: missing second part of surrogate pair.
  #   ... (while reading the value of key SpanAttributes) ...
  #
  # The insert throws, the pipeline retries, retries exhaust, and the span is
  # dead-lettered. In production this dead-lettered 13 groups for one project on
  # a single bad character.
  #
  # The fix sanitises every string a span contributes to a row to well-formed
  # UTF-16 (`String.prototype.toWellFormed()`, which replaces each lone surrogate
  # with U+FFFD, the Unicode replacement character) before it reaches ClickHouse.
  # This is lossless for every valid string and only ever touches genuinely
  # malformed input. It deliberately does NOT use ClickHouse's
  # `input_format_json_throw_on_bad_escape_sequence=0` setting, which would
  # persist the garbage instead of normalising it.
  # =========================================================================

  Background:
    Given a span is being written to the ClickHouse span store

  Rule: A lone surrogate in a span attribute is sanitised, not rejected

    Scenario: An attribute value truncated mid-emoji is stored
      Given a span attribute value that ends in a lone UTF-16 surrogate
      When the span is serialised for the ClickHouse insert
      Then the stored value is well-formed UTF-16 with the lone half replaced
      And the insert is accepted instead of being dead-lettered

    Scenario: An attribute key containing a lone surrogate is sanitised
      Given a span attribute whose key contains a lone UTF-16 surrogate
      When the span is serialised for the ClickHouse insert
      Then the stored key is well-formed UTF-16

    Scenario: A lone surrogate nested inside a JSON-serialised attribute is safe
      Given a span attribute whose value is an object containing a lone surrogate
      When the span is serialised for the ClickHouse insert
      Then the serialised JSON value is well-formed UTF-16

  Rule: Every free-text string on a span is sanitised, not only attributes

    Scenario: Lone surrogates anywhere on the span cannot fail the insert
      Given a span whose name, status message, scope name and version, service
        name, event names, and event / resource attribute keys and values each
        contain a lone UTF-16 surrogate
      When the repository builds the ClickHouse record for the insert
      Then every string in the record is well-formed UTF-16
      And the record survives a JSON encode/decode round-trip with no unpaired
        surrogate for ClickHouse to reject
