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

  Scenario: Full compatibility routes wait for complete characterization
    Given the existing drawer response has resource, evaluation, redaction, enrichment, event, link, and blob fields
    When the Trace package owns the paged tree and delta routes
    Then whole-tree, shared, REST and full-detail routes remain authoritative in the app
    And their migration waits for a complete byte-and-field characterization fixture

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

  Scenario: Browser presentation remains transport-neutral
    Given the browser display toolkit formats trace previews, costs, and terminal output
    When it is consumed by the app trace explorer
    Then it does not fetch, authorize, or reshape a trace response
    And existing route payload fields and nullability remain authoritative in the app

  @unit
  Scenario: Loaded-trace find remains a browser-owned presentation behaviour
    Given the app supplies the currently loaded trace rows to the Trace browser package
    When the viewer searches, cycles, or closes the find bar
    Then matching rows are indexed and highlighted without another trace request
    And the app retains only query, shortcut, and visual-skin composition
