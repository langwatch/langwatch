Feature: Trace media blob extraction at the ingestion edge
  As the LangWatch trace ingestion pipeline receiving spans whose message
  content embeds inline media bytes (base64 audio turns, data-URI images,
  file attachments)
  I want those bytes externalized to the content-addressed stored-objects
  store at the earliest edge point, before the command is staged on the queue
  So that the queue, event_log, fold state, and ClickHouse carry lightweight
  /api/files references instead of megabytes of base64, the same recording
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
  #
  # Privacy interlock: the data-privacy content drop runs later, at the
  #   RecordSpanCommand choke point. Extracting at the edge for a project
  #   whose policy drops span content would persist bytes the policy then
  #   discards. The edge hook therefore probes the resolved policy first and
  #   skips extraction entirely when any drop rule is configured — those
  #   projects keep today's behavior end to end.
  #
  # Related: specs/features/scenarios/externalize-event-byte-content.feature
  #   (scenario edge extraction), specs/event-sourcing/large-trace-blob-offload.feature
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
      referencing "/api/files/{projectId}/{id}" with no inline base64 data
    And the decoded bytes are stored once under the project, addressed by their SHA-256

  @integration
  Scenario: Raw realtime audio is wrapped into a playable container at store time
    Given an inline recording in a raw header-less format (pcm16 or G.711)
    When the recording is externalized (on the scenario path or the trace path)
    Then the stored bytes carry a WAV container around the exact original samples
    And the stored object's media type is "audio/wav" so the reference plays natively
    And both paths wrap identically, so the same recording still dedups to one object

  @integration
  Scenario: A data-URI image inside an image_url part is externalized
    Given a span input message with a part {type:"image_url", image_url:{url:"data:image/png;base64,..."}}
    When the span is ingested
    Then the staged part's image_url.url is "/api/files/{projectId}/{id}"
    And the PNG bytes are stored content-addressed under the project

  @integration
  Scenario: A PDF file part is externalized to a binary reference preserving the filename
    Given a span output message with a part {type:"file", file:{filename:"report.pdf", file_data:"data:application/pdf;base64,..."}}
    When the span is ingested
    Then the staged part is a binary reference with url "/api/files/{projectId}/{id}" and filename "report.pdf"
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
    Given a span whose gen_ai prompt rides in a span event attribute containing an inline image
    When the span is ingested
    Then the event attribute is rewritten to reference the stored object

  @unit
  Scenario: Attributes without media markers are never parsed or rewritten
    Given a span whose attributes carry large plain-text and JSON values with no
      base64 data URIs, file parts, or audio parts
    When the edge extraction hook runs
    Then every attribute value passes through byte-identical
    And no JSON parse of those values is attempted (cheap marker gate)

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
    And re-running extraction over it is a no-op (parts already reference urls)
