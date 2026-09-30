Feature: One query reference for both query languages

  As an agent with an API key and no UI
  I want one document that tells me what I can query and how
  So that I never guess a field name, a column name or a syntax

  LangWatch answers two query languages. LangWatchQL is SQL over the analytics
  views: counts, groupings, time series, joins. The trace filter is a
  Lucene-flavoured string over one trace list: fields, attributes, evaluators,
  free text. An agent that only knows one of them writes the wrong query for
  half the questions it is asked, and an agent that knows neither invents field
  names. `GET /api/v1/query/reference` is the single door that describes both.

  The reference is pure and cacheable: it reads the LangWatchQL catalog, the
  trace filter's field registry and the caller's permissions, and touches no
  tenant data. Live values are a separate call (`GET /api/traces/facets`),
  because reading them costs about thirty ClickHouse queries and they change
  under the caller while the reference does not.

  Background:
    Given a project API key holding "analytics:view"

  # ---------------------------------------------------------------------------
  # The document
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The reference describes both query languages in one payload
    When the reference is built for a caller
    Then it carries a LangWatchQL section with the schema, the limits and the endpoints that run it
    And it carries a trace filter section with the syntax, the fields and the endpoints that run it
    And it carries a decision table saying which language answers which kind of question

  @unit
  Scenario: Every trace filter field the product knows is published
    When the reference is built for a caller
    Then every field name in the trace filter registry appears in the reference
    And each published field carries its label, its value type and its group

  @unit
  Scenario: The open-ended attribute namespaces are published with their legacy spellings
    When the reference is built for a caller
    Then the canonical prefixes "trace.attribute.", "span.attribute." and "event.attribute." are published
    And each prefix lists the older spellings the translator still accepts

  @unit
  Scenario: The published syntax document names the canonical attribute prefixes
    When the trace filter syntax document is read
    Then it documents the canonical prefixes rather than only the older spellings

  @unit
  Scenario: Live values are not in the reference
    When the reference is built for a caller
    Then no field carries values read from the project's own traces
    And the reference names the facets endpoint as where those values come from

  # ---------------------------------------------------------------------------
  # Examples
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Every example is runnable as published
    When the reference is built for a caller
    Then every LangWatchQL example passes the LangWatchQL validator
    And every LangWatchQL example declares each parameter its statement binds
    And every trace filter example parses and translates to a database condition

  @unit
  Scenario: Example identifiers are unique and tagged by intent
    When the reference is built for a caller
    Then no two examples share an identifier
    And every example carries an intent and at least one tag

  @unit
  Scenario: An example a caller cannot run is published as unavailable
    Given a caller whose permissions withhold cost data
    When the reference is built for that caller
    Then the examples that read cost columns are marked unavailable
    And they still name the permission that would unlock them

  @unit
  Scenario: The LangWatchQL section says whether the surface is open to this project
    Given LangWatchQL is disabled for the project
    When the reference is built for a caller
    Then the LangWatchQL section reports itself disabled
    And the trace filter section is unaffected

  # ---------------------------------------------------------------------------
  # The endpoint
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A key holding analytics:view reads the reference
    When the caller gets "/api/v1/query/reference"
    Then the response is 200
    And it carries the LangWatchQL section, the trace filter section, the examples and the decision table

  @unit
  Scenario: An anonymous caller is refused before reaching the handler
    Given no credential
    When the caller gets "/api/v1/query/reference"
    Then the response is 401 in the canonical error envelope

  @unit
  Scenario: The reference embeds the very schema the schema endpoint publishes
    When the reference is built for a caller
    Then its LangWatchQL schema equals what that caller gets from the schema endpoint

  # ---------------------------------------------------------------------------
  # Drift
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The MCP server's committed reference fixture matches the platform
    When the reference is built with no permissions withheld
    Then it equals the fixture the MCP server's tests assert against

  @unit
  Scenario: Examples name the database this deployment serves
    Given a deployment serving the analytics views from another database
    When the reference is built for it
    Then every published statement names that database rather than the default

  @integration
  Scenario: Every published statement runs against the real catalog
    Given the LangWatchQL examples the reference publishes
    When each one is sent to the query endpoint with its parameters bound
    Then the endpoint answers rows for every one of them

  @unit
  Scenario: A key entitled only to traces still reads the filter vocabulary
    Given a key scoped to traces but not to analytics
    When it reads the query reference
    Then the trace filter half is answered in full
    And the LangWatchQL half arrives closed, with no catalog in it
