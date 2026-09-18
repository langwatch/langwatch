Feature: The trace filter language and its value discovery over the API key surface

  As an agent holding a project API key
  I want to filter traces with the same language the Trace Explorer uses
  And to read the values a field actually holds
  So that I can find traces without a browser and without guessing values

  The Trace Explorer's search bar is a query language (liqe, Lucene-flavored)
  with about fifty named fields plus three open-ended attribute namespaces. Until
  now it reached only over tRPC, so an API-key caller had the legacy filter map
  and a free-text query, and the value lists had no door at all. That is why
  agents invent field names: the richer language was there and unreachable.

  `POST /api/traces/search` gains `filter`, a filter string combined with
  everything else on the request. `GET /api/traces/facets` answers what the
  fields hold: the whole facet payload without a field, one field's values with
  it.

  Background:
    Given a project API key holding "traces:view"
    And the project has traces in the last day

  # ---------------------------------------------------------------------------
  # filter on search
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A filter string narrows the search
    When the caller searches with filter "status:error"
    Then only traces containing an error are returned

  @integration
  Scenario: A filter combines with the legacy filter map rather than replacing it
    When the caller searches with filter "status:error" and the legacy filter for one user
    Then every returned trace both contains an error and belongs to that user

  @integration
  Scenario: A filter combines with free text and with an explicit trace id list
    When the caller searches with filter "status:error", a free-text query and two trace ids
    Then every returned trace satisfies all three conditions

  @unit
  Scenario: A malformed filter is a validation failure naming the field
    When the caller searches with filter "status:"
    Then the response is 422 with code "validation_error"
    And the offending field is named

  @unit
  Scenario: A filter naming an unknown field lists the fields that exist
    When the caller searches with filter "statuz:error"
    Then the response is 422 with code "validation_error"
    And the response names the unknown field and the fields the language knows

  @unit
  Scenario: An empty filter is the same request as no filter
    When the caller searches with filter ""
    Then the result matches the same search sent without a filter

  @unit
  Scenario: The filter's bound parameters cannot collide with the legacy filter's
    When the filter translator and the legacy filter builder both produce conditions
    Then no parameter name means two different values in the same statement

  # ---------------------------------------------------------------------------
  # facets
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Without a field, the facets endpoint answers the whole discovery payload
    When the caller gets the facets endpoint with no field
    Then the response carries every facet the project has, with each facet's top values
    And it reports whether the payload is still being computed

  @unit
  Scenario: With a field, the facets endpoint answers that field's values and counts
    When the caller gets the facets endpoint for field "model"
    Then the response carries the values with their counts, the distinct total, and whether more remain

  @unit
  Scenario: A prefix narrows a field's values
    When the caller gets the facets endpoint for field "model" with prefix "gpt"
    Then every returned value starts with that prefix

  @unit
  Scenario: An attribute key is a field like any other
    When the caller gets the facets endpoint for field "trace.attribute.langwatch.user_id"
    Then the response carries the values that attribute key holds

  @unit
  Scenario: An unknown field is refused rather than answered empty
    When the caller gets the facets endpoint for field "not_a_facet"
    Then the response is 422 with code "validation_error"

  @unit
  Scenario: The facets route is not read as a trace id
    When the caller gets the facets endpoint
    Then the trace-by-id route does not answer it

  # ---------------------------------------------------------------------------
  # CLI
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The CLI sends a filter and keeps free text separate
    When the caller runs trace search with a filter and a text query
    Then the request carries both, and the filter is not sent as text

  @unit
  Scenario: An empty filtered result points at the facets command
    When a filtered trace search returns no rows
    Then the CLI says how to check what values the fields hold

  @unit
  Scenario: The CLI prints a field's values
    When the caller runs the trace facets command for a field
    Then it prints the values with their counts

  @unit
  Scenario: The CLI prints the filter fields and the syntax
    When the caller runs the trace fields command
    Then it prints every field with its label, value type and group
    And with the syntax flag it prints the language's syntax document
    And with the examples flag it prints the filter examples from the reference library

  @unit
  Scenario: A window bound is accepted as epoch milliseconds or as an ISO string
    Given a caller asking for one field's values over a window
    When the window bounds arrive on the query string as epoch milliseconds
    Then they are read as the same instants an ISO string would name

  @unit
  Scenario: Attribute values are withheld where captured content is
    Given a project that hides captured input or output from this caller
    When the caller asks for the values behind an attribute key
    Then the request is refused, because an attribute can carry a prompt
    But a named facet and the discovery payload are still answered

  @unit
  Scenario: A span clause is refused on the updated axis rather than silently dropping traces
    Given a search pulling by when traces were last modified
    When the filter carries a clause that matches spans by when they started
    Then the request is refused, naming the filter field
    But a clause over trace fields alone runs on the same axis

  @integration
  Scenario: Every published filter example runs against the real schema
    Given the filter examples the reference publishes
    When each one is compiled and sent to ClickHouse
    Then the database accepts every one of them

  @unit
  Scenario: A retention cutoff bounds the window an attribute facet reads
    Given a caller whose plan hides content older than a cutoff
    When they ask for the values behind an attribute key
    Then the window's floor is raised to that cutoff
    But a named facet keeps the window the caller asked for

  @unit
  Scenario: A window bound naming a day that does not exist is refused
    Given a caller asking for one field's values
    When a window bound names the thirtieth of February
    Then the request is refused rather than rolled forward into March
