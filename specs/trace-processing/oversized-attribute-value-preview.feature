Feature: Oversized span attribute values keep a readable preview
  As a LangWatch user inspecting a trace in the Trace Explorer
  I want a very large input or output to still show some of its actual content
  So that I can understand what was sent even when the full value was too
  large to keep in full

  # Customer report: a user input larger than the ingestion safety cap showed
  # only "[truncated: 314647 bytes]" in the Trace Explorer, with none of the
  # actual conversation content visible.
  #
  # Two limits apply (modules/trace/process/src/rules/trace-attribute-cap.rules.ts):
  #   - the record cap, MAX_RECORDED_ATTRIBUTE_VALUE_BYTES (8 MiB), applied by
  #     the record-span command before the event reaches event_log, on the
  #     inline and the spooled route alike. A value under it is kept whole.
  #   - the projection budget: the lean (ADR-022) keeps a preview of any
  #     top-level text attribute past 64 KB (IO keys) or 256 KB (any other)
  #     with an eventref, so a full read returns the whole value from event_log.
  #     What has no eventref (binary, nested, event, link and resource values
  #     past 256 KB) is replaced by the placeholder in the projection only.
  #
  # Anthropic's Full content mode sends up to 0.75 MB of content per span by
  # default and about 4 MB for a full 1M-token context, so both sit under the
  # record cap. The 10 MiB OTLP request body limit stays the outer bound.
  #
  # A cut is never silent: the placeholder replaces the value, and the span
  # lists every cut attribute with its original size under
  # langwatch.truncated_attributes, which the span detail shows as a notice.
  #
  # Binary blobs (base64 image/audio data URLs, raw bytes) have no readable
  # partial preview, so those keep the byte-count-only marker.

  Background:
    Given the trace-processing pipeline is folding span events

  Rule: A human-readable oversized value keeps a partial preview

    @unimplemented
    Scenario: A user input larger than the size cap still shows real content
      Given a span whose captured user input exceeds the attribute size cap
      When the span is ingested
      Then the stored input begins with the actual start of the user's text
      And the stored input states how much of the original content is shown
        and the original size
      And the Trace Explorer displays that partial input instead of only a
        byte count

    @unimplemented
    Scenario: A large custom attribute also keeps a smaller preview
      Given a span carrying an oversized custom (non-input/output) attribute
      When the span is ingested
      Then the stored attribute value keeps a short readable preview
      And the preview is smaller than an oversized user input/output preview,
        since arbitrary attributes are not bounded in count the way input
        and output are

    @unimplemented
    Scenario: A non-base64 data URL is treated as readable text, not binary
      Given a span whose input is an oversized "data:" URL that is not
        base64-encoded (e.g. inline percent-encoded text or SVG markup)
      When the span is ingested
      Then the stored input keeps a readable partial preview of that text
      And the stored input is not replaced by the binary-only byte-count
        marker

  Rule: Binary content still has no useful partial preview

    @unit
    Scenario: An oversized inline image is still replaced entirely
      Given a span whose input embeds a base64-encoded image data URL larger
        than the attribute size cap
      When the span is ingested
      Then the stored value is a short marker naming the byte size and mime
        type, with no partial image bytes

  Rule: An oversized message history keeps whole messages

    # A long conversation's model call carries the whole history in one
    # attribute; replacing it with a byte count left the last trace of a
    # 100k-token session about 300 tokens to read (langwatch/tasks#905).
    @unit
    Scenario: An oversized message history drops whole messages from its middle
      Given an LLM span whose input messages attribute is over the attribute size cap
      When the span is ingested
      Then the system prompt, the first user message and the most recent messages are kept whole
      And a marker message names how many messages were dropped
      And the value is under the cap and is still a message list

    @unit
    Scenario: A message history whose latest message alone is over the cap falls back to the placeholder
      Given an LLM span whose last input message alone is over the attribute size cap
      When the span is ingested
      Then the value is replaced by the byte-count placeholder

  Rule: Large text values reach the trace whole

    @unit @integration
    Scenario: A default Anthropic content span is recorded whole
      Given an Anthropic span in Full content mode with 0.75 MB of input messages
      When the span is ingested and read in full
      Then the input messages read back byte for byte
      And the span names no truncated attribute

    @unit @integration
    Scenario: A full 1M-token context span is recorded whole
      Given an Anthropic span with about 4 MB of input messages
      When the span is ingested and read in full
      Then the input messages read back byte for byte

    @unit
    Scenario: An oversized non-IO text attribute keeps a preview and a pointer to the full value
      Given a span with a text attribute over 256 KB that is not an input or output key
      When the span is projected
      Then the projection keeps a preview of it and an eventref to the full value
      And the span names no truncated attribute

  Rule: A cut value is named on the span

    @unit @integration
    Scenario: A value over the record cap is cut and the span names it
      Given a span with an attribute value over the 8 MiB record cap
      When the span is ingested
      Then the value is replaced by the byte-count placeholder
      And langwatch.truncated_attributes names the attribute and its original size

    @unit
    Scenario: A client cannot send its own truncation marker
      Given a span sent with its own langwatch.truncated_attributes attribute
      When the span is ingested
      Then the sent marker is dropped
      And langwatch.truncated_attributes names only the values the record cap cut

    @unit
    Scenario: A value cut in the projection names itself on the span
      Given a span with a base64 data URL over 256 KB outside the input and output keys
      When the span is projected
      Then the projection replaces it with the byte-count placeholder
      And langwatch.truncated_attributes names the attribute and its original size

    @unit @integration
    Scenario: The span detail says which values were cut
      Given a span that names truncated attributes
      When the span detail is opened in the Trace Explorer
      Then a notice lists each cut attribute with its original size
