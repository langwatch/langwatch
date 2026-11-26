# Stored Objects persistence and accounting: ../../modules/stored-object/adrs/001-package-boundary.md
# Reuse and retention: ../../modules/stored-object/adrs/002-content-addressed-reuse-and-owner-retention.md
Feature: Trace media blob extraction at the ingestion edge
  As the LangWatch trace ingestion pipeline receiving spans whose message
  content embeds inline media bytes (base64 audio turns, data-URI images,
  file attachments)
  I want those bytes externalized to the content-addressed stored-objects
  store at the earliest edge point, before the command is staged on the queue
  So that the queue, event_log, fold state, and ClickHouse carry short
  stored-object references instead of megabytes of base64, the same media in a
  project's traces is stored once, it expires with the traces that reference
  it, and the trace UIs can render players and previews instead of raw base64 dumps.

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
  #   sent after the command is durably staged, and storage reuses an object
  #   with the same bytes, so SDK retries and queue re-stages never double-store.
  #
  # Reuse:
  #   - Shape detection and part rewriting use the trace contract's content-part
  #     visitor, and one value walker serves span attributes and scenario events.
  #   - Storage is StoredObjectApi.storeFromBytes, which reuses an available
  #     object of the same project, purpose, SHA-256 and media type.
  #   - A rewritten part carries the reference string "/api/files/{projectId}/{id}",
  #     built and parsed only by the trace contract. Readers exchange it for a
  #     short-lived signed URL; no delivery URL is ever persisted.
  #
  # Privacy interlock: the data-privacy content drop runs later, at the
  #   RecordSpanCommand choke point. Extracting at the edge for a project
  #   whose policy drops span content would persist bytes the policy then
  #   discards. The edge hook therefore probes the resolved policy first and
  #   skips extraction entirely when any drop rule is configured — those
  #   projects keep today's behavior end to end.
  #
  # Retention: each extracted object is linked to the trace that stored it until
  #   that trace's retention ends, and deleted once no linked trace still holds
  #   it (stored-object ADR-002). Retroactive retention changes re-time the
  #   links; pins do not, as they do not change a trace's retention either.
  #   Trace media stored before links existed gets a link to the trace that
  #   stored it from a background release step, so it expires the same way.
  #
  # Default: the flag is ON for cloud and self-hosted alike. Self-hosted writes
  #   to the local-filesystem store unless S3 or Azure is configured; a store
  #   that refuses writes keeps the media inline (fail-open), as before.
  #
  # Related: specs/features/scenarios/externalize-event-byte-content.feature
  #   (scenario edge extraction), specs/trace-processing/large-trace-blob-offload.feature
  #   (ADR-022 spool + previews), specs/trace-processing/audio-player-in-traces.feature.

  Background:
    Given a project with object storage configured (S3 or the local-filesystem fallback)
    And the feature flag "release_trace_media_extraction" is enabled for the project
    And the project has no data-privacy content-drop rules

  # ===========================================================================
  # Track 0: on by default, large recordings survive
  # ===========================================================================

  @unit
  Scenario: Media extraction is on by default with no configuration
    Given a deployment with no operator rule for "release_trace_media_extraction"
    When the ingestion edge resolves the flag for any project
    Then it resolves to on, for cloud and self-hosted alike

  @unit
  Scenario: A Helm install with no durable store keeps trace media inline
    Given a Helm install with neither app.dataplane nor the local-filesystem volume enabled
    When the chart renders the app and worker environment
    Then it sets RELEASE_TRACE_MEDIA_EXTRACTION to 0
    And trace media stays inline in ClickHouse instead of landing on a disk lost on restart

  @unit
  Scenario: The Docker Compose stack keeps stored media on a volume the app and workers share
    Given the self-hosted Docker Compose stack
    When the app and the workers start
    Then both mount the same named stored-objects volume at the local-filesystem root

  @integration
  Scenario: A recording larger than the 8 MiB attribute cap survives ingestion
    Given an OTLP span whose "langwatch.input" carries an inline audio part
      whose base64 value is larger than 8 MiB
    When the span is ingested and recorded
    Then the recorded attribute carries a stored-object reference instead of the base64
    And the attribute is not listed in "langwatch.truncated_attributes"
    And the stored bytes are the whole recording

  @integration
  Scenario: A trace export carrying an hour of compressed audio reaches extraction
    Given the trace receiver on its default body cap of 64 MiB
    When an exporter sends one trace export of about 40 MiB of base64 audio, past the old 10 MiB limit
    Then the receiver accepts it and hands the whole export to trace ingestion

  @integration
  Scenario: A trace export over the deployment's body cap is refused
    Given a deployment that sets "OTLP_TRACES_MAX_BODY_BYTES" below the default
    When an exporter sends a trace export larger than that setting, plain or compressed
    Then the export is refused as too large
    And nothing is handed to trace ingestion

  @unit
  Scenario: A stored media reference survives secret redaction
    Given the project's PII redaction level is essential, which redacts secrets
    And a span's audio was replaced with a "/api/files/<projectId>/<storedObjectId>" reference
    When the worker redacts the span's text
    Then the reference is kept whole, whatever shape the project id has
    And a key-shaped value beside it is still redacted

  # ===========================================================================
  # Track 1 — extraction shapes
  # ===========================================================================

  @integration
  Scenario: An AI-SDK audio file part inside a span input is externalized before staging
    Given an OTLP span whose "langwatch.input" attribute carries chat messages
      with a part {type:"file", mediaType:"audio/pcm16", data:"<base64 pcm>"}
    When the span is ingested through the collector
    Then the staged command's "langwatch.input" carries an input_audio part
      referencing "/api/files/{projectId}/{id}" with no inline base64 data
    And the decoded bytes are stored once under the project

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
    Then the staged part references "/api/files/{projectId}/{id}" instead of the data URI
    And the PNG bytes are stored under the project

  @integration
  Scenario: A PDF file part is externalized to a binary reference preserving the filename
    Given a span output message with a part {type:"file", file:{filename:"report.pdf", file_data:"data:application/pdf;base64,..."}}
    When the span is ingested
    Then the staged part is a binary part referencing the stored object, with filename "report.pdf"
    And no base64 remains in the staged command

  @integration
  Scenario: Media nested inside a typed-raw JSON string is still found
    Given a span whose "langwatch.input" attribute is a typed value
      {type:"raw", value:"<JSON string of messages carrying an inline audio part>"}
    When the span is ingested
    Then the nested JSON string is rewritten in place with the externalized reference
    And the surrounding typed-value envelope is preserved byte-for-byte otherwise

  @unit
  Scenario: Media inside a nested JSON string larger than 50 MiB is still found
    Given a span attribute whose value is a JSON string of messages larger than 50 MiB
      carrying an inline audio part
    When the media walk looks for inline media
    Then it finds the audio part inside the nested JSON string

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
  Scenario: The same recording on two traces is stored once
    Given a trace already externalized an audio turn to the project's store
    When a span of another trace carrying the byte-identical recording is ingested
    Then the span's reference resolves to the same stored object id
    And no second copy is written to storage
    And both traces are recorded as owners of the object

  @integration
  Scenario: A re-exported span reuses the media it stored the first time
    Given a span whose media was externalized, and whose export the SDK retries
    When the retried span is ingested
    Then its reference resolves to the same stored object id
    And no second copy is written to storage

  @integration
  Scenario: Extracted media is stored on behalf of the span's trace
    When a span with inline media is ingested
    Then the bytes are stored for the "trace_content" purpose with the span's trace as owner
    So that Stored Objects keeps them until that trace's retention ends

  @integration
  Scenario: A late span's media is retained from the span's start
    When a span that started 20 days ago is ingested with inline media
    Then the bytes are stored with the span's start time as the retention start
    So that the media expires with the span's trace rows, which expire from that start

  @unit
  Scenario: Trace media names the project's trace retention when it is stored
    When trace media is stored for a project that keeps traces for 30 days
    Then the store names a 30-day retention for the trace's link
    And scenario event media, which follows no retention category, names none

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
    And re-running extraction over it is a no-op because parts carry no inline bytes

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

  @unit
  Scenario: A recording that takes longer to store than the span's deadline is kept
    Given a span whose one inline recording is large enough that storing it
      outlasts the span's extraction deadline but not the per-store ceiling
    When the span is ingested
    Then the recording is stored and the attribute carries its reference
    And no store starts after the deadline, and a store past the ceiling stays inline

  @integration
  Scenario: The receiver publishes the edge media fail-open series
    Given a project whose feature-flag store cannot be read
    When a span carrying inline media is exported to the OTLP receiver
    Then the span is still ingested unmodified
    And the fail-open is counted under the stage that failed, so a hook that
      stood down for every span is distinguishable from one with nothing to do
