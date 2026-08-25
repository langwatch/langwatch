# Stored Objects persistence and accounting: ../../packages/features/stored-object/adrs/001-package-boundary.md
Feature: Trace media blob extraction at the ingestion edge
  As the LangWatch trace ingestion pipeline receiving spans whose message
  content embeds inline media bytes (base64 audio turns, data-URI images,
  file attachments)
  I want those bytes externalized to the content-addressed stored-objects
  store at the earliest edge point, before the command is staged on the queue
  So that the queue, event_log, fold state, and ClickHouse carry lightweight
  durable StoredObjectReferences instead of megabytes of base64, the same recording
  captured by a scenario run and by its trace is stored exactly once, and the
  trace UIs can render players and previews instead of raw base64 dumps.

  # Placement decision (balances "earliest" against the receiving guarantee):
  #   The extraction runs inside the ADR-022 processCommandData edge hook
  #   (TraceRequestCollectionService.ingestNormalizedSpan), BEFORE the
  #   maybeSpool size check. This is the same point where the whole-payload
  #   S3 spool already runs today — extracting the media part first means the
  #   remaining payload usually falls back under COMMAND_INLINE_THRESHOLD, so
  #   the transient spool round-trip (PUT whole payload, GET it back, DELETE)
  #   is replaced by one permanent content-addressed PUT.
  #   The receiving guarantee is preserved the same way the spool preserves
  #   it: the hook is fail-open (any storage/parse error returns the command
  #   data unchanged and ingestion proceeds inline), the HTTP response is only
  #   sent after the command is durably staged, and content-addressed PUTs are
  #   idempotent so SDK retries and queue re-stages never double-store.
  #
  # Reuse:
  #   - Shape detection and part rewriting reuse the stored-objects visitor
  #     (visit-content-part.ts) and content-extractor walkers that already
  #     externalize scenario-event media — one vocabulary, one rewrite.
  #   - Storage is StoredObjectsService.storeFromBytes: SHA-256
  #     content-addressing namespaced by project. A scenario run's audio turn
  #     and the same turn observed on a trace resolve to the same stored
  #     object id — stored once, referenced twice.
  #   - Persisted trace shapes carry StoredObjectReference values. Trace read
  #     and rendering adapters resolve fresh service-delivery capabilities at
  #     the presentation boundary; `/api/files/...` is not persisted authority.
  #
  # Privacy interlock: the data-privacy content drop runs later, at the
  #   RecordSpanCommand choke point. Extracting at the edge for a project
  #   whose policy drops span content would persist bytes the policy then
  #   discards. The edge hook therefore probes the resolved policy first and
  #   skips extraction entirely when any drop rule is configured — those
  #   projects keep today's behavior end to end.
  #
  # Retention: Stored Objects is content-addressed and currently GC-free, so
  #   extracted media outlives the trace's retention TTL. It is still counted
  #   once in the project byte ledger. Until trace-owned retention cleanup lands,
  #   the feature flag ships default OFF and enabling it is an explicit
  #   per-project / per-deployment opt-in.
  #
  # Related: specs/features/scenarios/externalize-event-byte-content.feature
  #   (scenario edge extraction), specs/trace-processing/large-trace-blob-offload.feature
  #   (ADR-022 spool + previews), specs/trace-processing/audio-player-in-traces.feature.

  Background:
    Given a project with object storage configured (S3 or the local-filesystem fallback)
    And the feature flag "release_trace_media_extraction" is enabled for the project
    And the project has no data-privacy content-drop rules

  # ===========================================================================
  # Track 1 — extraction shapes
  # ===========================================================================

  @integration
  Scenario: An AI-SDK audio file part inside a span input is externalized before staging
    Given an OTLP span whose "langwatch.input" attribute carries chat messages
      with a part {type:"file", mediaType:"audio/pcm16", data:"<base64 pcm>"}
    When the span is ingested through the collector
    Then the staged command's "langwatch.input" carries an input_audio part
      carrying a durable StoredObjectReference with no inline base64 data
    And the decoded bytes are stored once under the project, addressed by their SHA-256

  @integration
  Scenario: Raw realtime audio is wrapped into a playable container at store time
    Given an inline recording in a raw header-less format (pcm16 or G.711)
    When the recording is externalized (on the scenario path or the trace path)
    Then the stored bytes are a linear-PCM WAV (G.711 is decoded first — browser
      WAV playback is PCM-only)
    And the stored object's media type is "audio/wav" so the reference plays natively
    And both paths wrap identically, so the same recording still dedups to one object

  @integration
  Scenario: A data-URI image inside an image_url part is externalized
    Given a span input message with a part {type:"image_url", image_url:{url:"data:image/png;base64,..."}}
    When the span is ingested
    Then the staged part carries a durable StoredObjectReference instead of a delivery URL
    And the PNG bytes are stored content-addressed under the project

  @integration
  Scenario: A PDF file part is externalized to a binary reference preserving the filename
    Given a span output message with a part {type:"file", file:{filename:"report.pdf", file_data:"data:application/pdf;base64,..."}}
    When the span is ingested
    Then the staged part is a StoredObjectReference with filename "report.pdf"
    And no base64 remains in the staged command

  @integration
  Scenario: Media nested inside a typed-raw JSON string is still found
    Given a span whose "langwatch.input" attribute is a typed value
      {type:"raw", value:"<JSON string of messages carrying an inline audio part>"}
    When the span is ingested
    Then the nested JSON string is rewritten in place with the externalized reference
    And the surrounding typed-value envelope is preserved byte-for-byte otherwise

  @integration
  Scenario: Media carried on span events is externalized like span attributes
    Given an instrumentation that records the prompt on a span event, with an inline image in it
    When the span is ingested
    Then the event attribute is rewritten to reference the stored object

  @unit
  Scenario: Attributes without media markers are never parsed or rewritten
    Given a span whose attributes carry large plain-text and JSON values with no
      base64 data URIs, file parts, or audio parts
    When the edge extraction hook runs
    Then every attribute value passes through byte-identical
    And no JSON parse of those values is attempted (cheap marker gate)

  # Provider wire shapes. Instrumentation for the Anthropic and Google SDKs
  # records the request the customer sent, not a normalized one, so the media
  # part arrives in that provider's own vocabulary. Both name the media type
  # with an underscore, which the camelCase markers and the AG-UI source
  # decoder do not recognise, so before this the bytes passed the whole
  # pipeline untouched and landed inline in ClickHouse.

  @unit
  Scenario: An Anthropic image block carries its bytes in a base64 source
    Given a content part {type:"image", source:{type:"base64", media_type:"image/png", data:"<base64>"}}
    When the content-part decoder reads it
    Then it resolves to an image part with inline data of media type "image/png"
    And the extractor treats it as extractable, exactly like a data-URI image_url part

  @unit
  Scenario: An Anthropic document block carries its bytes in a base64 source
    Given a content part {type:"document", source:{type:"base64", media_type:"application/pdf", data:"<base64>"}}
    When the content-part decoder reads it
    Then it resolves to a document part with inline data of media type "application/pdf"

  @unit
  Scenario: An Anthropic image block pointing at a hosted URL keeps that URL
    Given a content part {type:"image", source:{type:"url", url:"https://example.com/a.png"}}
    When the content-part decoder reads it
    Then it resolves to an image part sourced from that URL
    And the extractor leaves it alone, because there are no inline bytes to store

  @unit
  Scenario: A Gemini inline-data part carries its bytes with no part type at all
    Given a content part {inline_data:{mime_type:"application/pdf", data:"<base64>"}}
    When the content-part decoder reads it
    Then it resolves to a document part with inline data of media type "application/pdf"
    And the camelCase spelling {inlineData:{mimeType, data}} resolves identically

  @unit
  Scenario: The media type of a Gemini inline-data part decides how it renders
    Given inline-data parts of media type "image/png", "audio/wav" and "text/plain"
    When the content-part decoder reads each of them
    Then they resolve to an image part, an audio part and a document part

  @integration
  Scenario: An Anthropic image block inside a span input is externalized before staging
    Given an OTLP span whose "langwatch.input" attribute is the Anthropic request,
      carrying a {type:"image", source:{type:"base64", media_type, data}} block
    When the span is ingested through the collector
    Then the staged block references "/api/files/{projectId}/{id}" with no inline base64 data
    And the trace summary carries a media reference for the image

  @integration
  Scenario: A Gemini inline-data part inside a span input is externalized before staging
    Given an OTLP span whose "langwatch.input" attribute is the Gemini request,
      carrying an {inline_data:{mime_type, data}} part
    When the span is ingested through the collector
    Then the staged part references "/api/files/{projectId}/{id}" with no inline base64 data

  # ===========================================================================
  # Track 2 — dedup and cost
  # ===========================================================================

  @integration
  Scenario: The same recording on a scenario event and on a trace is stored once
    Given a scenario run already externalized an audio turn to the project's store
    When a trace span carrying the byte-identical recording is ingested
    Then the span's reference resolves to the same stored object id
    And no second copy is written to storage

  @integration
  Scenario: The same bytes in two attributes of one span are stored once
    Given a span that carries the same image both in its chat content and in a
      prompt-variables attribute, as a managed-prompt run does
    When the span is ingested
    Then both attributes reference the same stored object id
    And only one copy is written to storage
    # The engine compiles the prompt from the dataset value and then sends the
    # message, so the same picture legitimately appears twice in one span. It
    # must cost one object, not two.

  @integration
  Scenario: Extraction before the spool check keeps the queue light
    Given a span whose only oversized content is a 2 MB inline audio part
    When the span is ingested with the ADR-022 spool also enabled
    Then the media is externalized first and the remaining payload fits inline
    And no transient spool object is written for the command

  # ===========================================================================
  # Track 3 — guarantees and guards
  # ===========================================================================

  @integration
  Scenario: A storage failure falls back to inline ingestion (fail-open)
    Given the object store rejects writes
    When a span with inline media is ingested
    Then the span is staged with its original inline payload
    And ingestion succeeds and the failure is logged and counted

  @integration
  Scenario: A project with a content-drop policy skips edge extraction
    Given the project's resolved data-privacy policy drops a span content category
    When a span with inline media is ingested
    Then no bytes are written to the object store at the edge
    And the span proceeds unchanged to the worker where the drop applies as today

  @integration
  Scenario: The flag disabled keeps ingestion byte-identical to today
    Given the feature flag "release_trace_media_extraction" is disabled for the project
    When a span with inline media is ingested
    Then the staged command carries the original inline payload
    And no stored object is created

  @unit
  Scenario: A queue retry after extraction re-stages the already-rewritten command
    Given a span whose media was externalized at the edge
    When the staged command is retried by the group queue
    Then the command still carries only the stored-object references
    And re-running extraction over it is a no-op because parts already carry durable references

  @unit
  Scenario: Redacted trace content never leaks its media references
    Given a viewer whose protections hide captured input or output
    When a trace summary carrying media refs is redacted for that viewer
    Then the redacted payload carries no ref fields and no reserved ref attributes
      for the hidden category, so the stored bytes stay unfetchable from it
    And the refs of a still-visible category remain intact

  @unit
  Scenario: Extraction cost inside the collector request is bounded
    Given a span carrying more inline media parts than the per-span cap,
      or a storage backend responding slower than the extraction deadline
    When the span is ingested
    Then at most the capped number of parts is externalized, stored in bounded
      concurrent batches, and the rest stay inline
    And once the deadline passes no further parts are stored, parts already
      externalized keep their references (no orphaned bytes), and the drop is
      logged and counted rather than silent
