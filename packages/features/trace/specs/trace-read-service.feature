Feature: Trace span-tree read service

  Scenario: A span tree is read page by page with the live response shape
    Given a trace exists with projected span summaries
    When the Trace service reads a page for the trace's project
    Then every tracesV2 SpanTreeNode field is preserved
    And the next cursor contains the last returned span's timestamp and id

  Scenario: A tree cost is withheld for a restricted viewer
    Given a span has a cost
    When the viewer cannot see costs
    Then the span's cost is null
    And all other span-tree fields are unchanged

  Scenario: A trace read is tenant scoped
    Given a trace belongs to project "project-1"
    When the Trace service reads it for project "project-2"
    Then it returns an empty page with a null cursor

  Scenario: A stale occurrence timestamp still reads the trace
    Given the bounded occurrence-time lookup returns no rows
    When the Trace service reads the span tree
    Then the persistence adapter retries without the occurrence-time bound

  Scenario: Compatibility routes wait for complete characterization
    Given the existing drawer response has resource, evaluation, redaction, enrichment, event, link, and blob fields
    When the Trace package is introduced
    Then existing REST and tRPC routes remain authoritative
    And migration waits for a complete byte-and-field characterization fixture

  Scenario: Cost fallback remains owned by one canonical implementation
    Given a span has no persisted positive cost but has custom, cache, audio, model, or guardrail pricing inputs
    When the Trace package is introduced without the canonical cost calculator
    Then no existing route migrates to the package
    And the package keeps all fallback source attributes available for the canonical move

  Scenario: Browser presentation remains transport-neutral
    Given the browser display toolkit formats trace previews, costs, and terminal output
    When it is consumed by the app trace explorer
    Then it does not fetch, authorize, or reshape a trace response
    And existing route payload fields and nullability remain authoritative in the app
