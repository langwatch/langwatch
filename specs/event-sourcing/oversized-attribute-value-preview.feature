Feature: Oversized span attribute values keep a readable preview
  As a LangWatch user inspecting a trace in the Trace Explorer
  I want a very large input or output to still show some of its actual content
  So that I can understand what was sent even when the full value was too
  large to keep in full

  # Customer report: a user input larger than the ingestion safety cap showed
  # only "[truncated: 314647 bytes]" in the Trace Explorer, with none of the
  # actual conversation content visible. capOversizedAttributes.ts
  # (event-sourcing/pipelines/trace-processing/utils/) is the mechanism that
  # bounds oversized span attribute values before they reach the fold
  # pipeline; today it discards the entire value once it is over the limit.
  #
  # This is orthogonal to the "release_trace_blob_offload" mechanism
  # (specs/event-sourcing/large-trace-blob-offload.feature, ADR-022), which
  # is an opt-in, per-project feature flag (default OFF) for recovering the
  # FULL original value via a transient S3 spool + event_log. That mechanism
  # is unaffected by this change and remains the path to a byte-identical
  # "show full" experience. This feature covers the always-on fallback: even
  # without that flag, a reader should see *something* of the real content,
  # not just a byte count.
  #
  # Binary blobs (base64 image/audio data URLs, raw bytes) are the
  # exception — a partial slice of base64 or raw bytes has no readable
  # value, so those keep today's byte-count-only marker.

  Background:
    Given the trace-processing pipeline is folding span events

  Rule: A human-readable oversized value keeps a partial preview

    Scenario: A user input larger than the size cap still shows real content
      Given a span whose captured user input exceeds the attribute size cap
      When the span is ingested
      Then the stored input begins with the actual start of the user's text
      And the stored input states how much of the original content is shown
        and the original size
      And the Trace Explorer displays that partial input instead of only a
        byte count

    Scenario: A large custom attribute also keeps a smaller preview
      Given a span carrying an oversized custom (non-input/output) attribute
      When the span is ingested
      Then the stored attribute value keeps a short readable preview
      And the preview is smaller than an oversized user input/output preview,
        since arbitrary attributes are not bounded in count the way input
        and output are

    Scenario: A non-base64 data URL is treated as readable text, not binary
      Given a span whose input is an oversized "data:" URL that is not
        base64-encoded (e.g. inline percent-encoded text or SVG markup)
      When the span is ingested
      Then the stored input keeps a readable partial preview of that text
      And the stored input is not replaced by the binary-only byte-count
        marker

  Rule: Binary content still has no useful partial preview

    Scenario: An oversized inline image is still replaced entirely
      Given a span whose input embeds a base64-encoded image data URL larger
        than the attribute size cap
      When the span is ingested
      Then the stored value is a short marker naming the byte size and mime
        type, with no partial image bytes
