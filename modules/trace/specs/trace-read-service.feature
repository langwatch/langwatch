Feature: Trace span-tree read service

  @unit
  Scenario: A span tree is read page by page with the live response shape
    Given a trace exists with projected span summaries
    When the Trace service reads a page for the trace's project
    Then every tracesV2 SpanTreeNode field is preserved
    And the next cursor contains the last returned span's timestamp and id

  @unit
  Scenario: A tree cost is withheld for a restricted viewer
    Given a span has a cost
    When the viewer cannot see costs
    Then the span's cost is null
    And all other span-tree fields are unchanged

  @unit
  Scenario: A trace read is tenant scoped
    Given a trace belongs to project "project-1"
    When the Trace service reads it for project "project-2"
    Then it returns an empty page with a null cursor

  @unit
  Scenario: A stale occurrence timestamp still reads the trace
    Given the bounded occurrence-time lookup returns no rows
    When the Trace service reads the span tree
    Then the persistence adapter retries without the occurrence-time bound

  @unit
  Scenario: A live waterfall receives row-version updates
    Given a span closes after its initial projection
    When the Trace service reads updates after the prior row version
    Then it returns the updated span in start-time order
    And the query is not bounded by occurrence time

  @unit
  Scenario: Full-read characterization preserves storage and projected summary distinctions
    Given a trace has a frozen storage anchor, an earlier span start, topic identities, and reserved token metrics
    When the legacy viewer or export read maps its trace summary
    Then its reported start is the earliest span start rather than the storage anchor
    And topic and subtopic identities remain in metadata
    And every reserved token metric remains in the response
    And trace_summaries, trace_analytics, and timeseries rollups are not substituted for one another

  @unit
  Scenario: Cost fallback remains owned by one canonical implementation
    Given a span has no persisted positive cost but has custom, cache, audio, model, or guardrail pricing inputs
    When the Trace service reads the span for a viewer who can see costs
    Then a persisted positive cost wins unchanged
    And otherwise it delegates to the canonical ModelProviderService estimateCost
    And the span-tree response shape remains unchanged

  @unit
  Scenario: Loaded-trace find remains a browser-owned presentation behaviour
    Given the app supplies the currently loaded trace rows to the Trace browser package
    When the viewer searches, cycles, or closes the find bar
    Then matching rows are indexed and highlighted without another trace request
    And the app retains only query, shortcut, and visual-skin composition

  # The LLM-mode read hands a trace to a model rather than to a screen, so its
  # three timestamps are rendered as a reader would say them. Recent times read
  # as an interval; anything older than a day reads as a date, because
  # "97 hours ago" tells a model nothing it can act on.

  @unit
  Scenario: A time inside the last day reads as an interval
    Given a trace whose start is minutes old
    When it is read in LLM mode
    Then the start reads as an interval ending in "ago"

  @unit
  Scenario: A time older than a day reads as a date
    Given a trace whose start is more than a day old
    When it is read in LLM mode
    Then the start reads as a day, month and time of day rather than as an interval

  @unit
  Scenario: A missing timestamp reads as nothing rather than as 1970
    Given a trace carrying no insert or update time
    When it is read in LLM mode
    Then those times read as empty strings, not as dates at the epoch

  @unit
  Scenario: An ai.generateText span's input reads as chat messages
    Given a Vercel AI SDK span whose input messages are stored as a messages envelope
    When the span is read for the trace drawer
    Then its input is a chat_messages list holding those messages, as the trace schema declares

  @unit
  Scenario: A single stored message reads as a one-message chat
    Given a span whose output messages are stored as one message record
    When the span is read
    Then its output is a chat_messages list holding that one message

  @unit
  Scenario: A chat value that carries no messages reads as json
    Given a span whose input messages attribute holds a record without messages
    When the span is read
    Then its input is read as json rather than an invalid chat_messages value

  @unit
  Scenario: A span whose own attributes share a name with a request param still reads
    Given a span whose own attributes include "user.*" and "stop.*" keys
    When the trace is read with its spans
    Then the span's params carry those attributes as objects
    And the spans match the declared output

  @unit
  Scenario: AI SDK tool parts in a stored message satisfy the trace schema
    Given a stored assistant message holding a "tool-call" part and a tool message holding a "tool-result" part
    When the trace is read with its spans
    Then the chat message schema accepts both parts as stored

  @unit
  Scenario: A trace read for a private organization whose route is missing answers the handled refusal
    Given an organization recorded as private whose ClickHouse route is missing
    When one of its traces is read with its spans
    Then the read is refused with private_dataplane_unavailable (503)
    And it is not wrapped into a bare internal_error

  @unit
  Scenario: A span tree page past a cursor elects each span's latest version over the whole trace
    Given a span tree page is read after a cursor
    When the statement elects each span's latest version
    Then the cursor filters only the elected spans
    And the election is bounded by the trace alone

  @unit
  Scenario: Every span-tree read is fenced by the reader's proof
    Given a reader whose proof covers its own project
    When the span tree, its live delta, its evaluation spans and events, its ingest lag and its occurrence lookup are read
    Then each statement is a reader statement over the proof's tenants
    And each carries the tenant setting the row policy checks

  @integration
  Scenario: A trace's evaluation spans, events, ingest lag and occurrence are read from its latest versions
    Given a trace whose span was stored twice, and another project's span on the same trace id
    When the trace's evaluation spans and events, its project's ingest lag and its occurrence are read
    Then each read returns only the reader's latest version, events newest first without exceptions
    And the occurrence is the trace summary's own time

  @unit
  Scenario: Every full-span read of a trace is fenced by the reader's proof
    Given a reader whose proof covers its own project, or a braid it reads spans through
    When the trace's full, normalized and stored spans are read
    Then each statement is a reader statement over the proof's tenants with the tenant setting
    And it elects each span's latest version within the stored_spans id bound and the memory ceiling
    And a braided read applies the owner's condition without naming the owner

  @unit
  Scenario: A full trace record's summary and thread rows are read within the record's own tenant
    Given a full record read or a thread read for one project
    When the trace's summary or the thread's traces are read
    Then each statement is a reader statement over that project alone with the tenant setting
    And it elects each trace's latest summary, the thread read repeating its conversation filter in the election

  @unit
  Scenario: A single span is read within the reader's proof
    Given a reader whose proof covers its own project, or a braid through which it reads the owner's span
    When one span is read by its trace and span ids, whole or for derivation
    Then the statement is a reader statement over the proof's tenants with the tenant setting
    And it reads the span's newest version eagerly within the stored_spans id bound
    And a braided read elects each project's latest version under the braid's condition and keeps the owner's

  @unit
  Scenario: A full trace record's spans are elected on the engine's StartTime key within the record's own tenant
    Given a full record read for one project whose summary names the trace's occurrence, or none
    When the trace's spans are read
    Then the statement is a reader statement over that project alone with the tenant setting
    And it elects each span's newest StartTime, the trace and the occurrence window repeated in the election
    And a summary with no occurrence reads the trace's spans unwindowed

  @unit
  Scenario: A trace's light span reads and event reads are fenced by the reader's proof
    Given a reader whose proof covers its own project
    When a trace's span resources, span tree, events or one span's events are read
    Then each statement is a reader statement over the proof's tenants with the tenant setting
    And it elects each span's latest version within the stored_spans id bound
    And an events read unrolls the events only after the election, so no stale version's event is read

  @unit
  Scenario: A live span poll and the trace time lookup are read within the reader's proof
    Given a reader whose proof covers its own project
    When the spans started since a time are polled, or a trace's time is looked up while its index is not ready
    Then each statement is a reader statement over the proof's tenants with the tenant setting
    And the poll is bounded by its own since-time, repeated in the election, and not by the id index
    And the time lookup reads the earliest occurrence of the trace's summary, recent window first

  @unit
  Scenario: A trace's span page is counted and read within the reader's proof
    Given a reader whose proof covers its own project, or a braid through which it reads the owner's spans
    When a page of a trace's spans is listed
    Then the count and the page are reader statements over the proof's tenants with the tenant setting
    And the count is bounded by the stored_spans id index; a braided count elects each span's latest version and names the projects it counts
    And the page elects each span's latest version within the exact range the count found, the range repeated in the election

  @unit
  Scenario: A page of traces' event rollups and a model's recent spans are read within the reader's proof
    Given a reader whose proof covers its own project
    When the event names of a page of traces are rolled up, or recent spans are sampled for a list of models
    Then each statement is a reader statement over the proof's tenants with the tenant setting
    And the rollup elects each span's latest version over the page's traces and time range, keeps only spans whose latest version has events, and unrolls the events after the election
    And the model sample reads its candidate traces from the trace summaries under the same fence

  @unit
  Scenario: A trace's LangWatch signals and the models in use are read within the reader's proof
    Given a reader whose proof covers its own project
    When a trace's LangWatch signals are read, or the models in use since a time are counted
    Then each statement is a reader statement over the proof's tenants with the tenant setting
    And the signals read elects each span's latest attribute keys, earliest spans first, and binds every key and bucket name it matches
    And under a braid each owner's span is read under the braid's condition and names its owner
    And the model count counts each span once across its stored versions, without electing a version

  @unit
  Scenario: A trace's summary and the tenants holding it are read within the reader's proof
    Given a reader whose proof covers its own project
    When a trace's summary is read, or the tenants holding the trace are listed
    Then each statement is a reader statement over the proof's tenants with the tenant setting
    And the summary read elects each tenant's latest summary and returns the first tenant's, the same row on every read
    And the tenant list reads each tenant once, in tenant order, without electing a version

  @unit
  Scenario: A trace's analytics row and the anchors of many traces are read within the reader's proof
    Given a reader whose proof covers its own project
    When a trace's analytics row is read back, or the anchors of many traces are read
    Then each statement is a reader statement over the proof's tenants with the tenant setting
    And the row read elects the latest version and ranks versions tied on it by fold progress, the same row on every read
    And a caller's window bounds the outer read only, and the anchors read is bounded by the window or else the trace id index
