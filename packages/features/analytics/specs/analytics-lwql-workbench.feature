Feature: LangWatchQL query workbench

  As an authorized LangWatch project member
  I want to query the live analytics schema, inspect native results, and chart
  them with a controlled Vega-Lite specification
  So that analytical questions stay tenant-scoped and secure

  Background:
    Given a project whose LangWatchQL analytics SQL API is available to the signed-in member

  Rule: Availability, authorization, and ownership are enforced at the server boundary

    @integration
    Scenario: An unavailable or disabled deployment does not expose the workbench
      Given LangWatchQL provisioning is absent or its project switch is off
      When the member opens Custom query or calls its schema and query endpoints
      Then navigation and the page show the unavailable state and the endpoints return the named refusal
      And no browser environment value can enable the surface

    @integration
    Scenario: Organization rules and project permissions govern access
      Given an organization-scoped rule enables LangWatchQL for the project
      When an authorized member opens Custom query and a member without analytics permission does the same
      Then the authorized member sees only their live project schema
      And the unauthorized member sees the permission guard, not the workbench

    @unit
    Scenario: The workbench has no unsolicited work or hidden client persistence
      Given the workbench source
      When it is inspected for polling, timers, browser storage, export, sharing, agent, or connector surfaces
      Then none is present and the edited specification stays in memory only

  Rule: The live schema drives editor assistance and the backend owns SQL validation

    @unit
    Scenario: Schema documentation and completion use the live response
      Given a schema response containing datasets, columns, types, descriptions, units, joins, freshness, time columns, and examples
      When the member browses it or requests Monaco completion and hover details
      Then every displayed item comes from that response in its returned order
      And no physical table or column list is hard-coded in the browser

    @integration
    Scenario: Gated schema fields remain safe and useful
      Given a schema response containing an unavailable content-gated column
      When the member expands its dataset or inserts a dataset, column, or example query
      Then the field is omitted or visibly disabled without exposing its value or hidden detail
      And insertion copies the response's identifier or SQL

    @unit
    Scenario: The browser submits exact SQL and does not validate a second language
      Given a draft statement the backend would reject
      When the member runs it
      Then the statement is sent unmodified and the backend's coded refusal is what the member sees

  Rule: Request state distinguishes draft, submitted, and visible result

    @unit
    Scenario: Run and Reload preserve the intended snapshot
      Given a draft SQL statement and named scalar parameters
      When the member runs it successfully and later edits the draft
      Then the successful outcome owns an immutable submitted snapshot, editing marks it stale, and the action returns to Run query
      And Reload reruns the submitted snapshot rather than the edited draft

    @unit
    Scenario: Requests are manual, single-flight, and cancellation-safe
      Given a query is in flight or a previous result is visible
      When the member runs again, leaves the page, or cancels the newer request
      Then no duplicate or background request is issued
      And an aborted or late response cannot replace the visible previous result

    @integration
    Scenario: Reserved period parameters are filled only when declared
      Given SQL declares period_start and/or period_end as ClickHouse date-time parameters
      When the member runs it with the page's UTC window
      Then only declared parameters are bound with the half-open page window and the SQL remains unchanged

    @unit
    Scenario: Reserved parameter misuse is refused before execution
      Given SQL declares a reserved parameter as a non-date-time or the request supplies one itself
      When the statement is run or saved
      Then it is refused with the corresponding named validation error and does not reach the database

    @unit
    Scenario: A statement without a period reports that fact
      Given SQL declares neither reserved period parameter
      When the member runs it with a selected or one-off window
      Then it executes unchanged and reports that it does not follow the page period

    @integration
    Scenario: The step a statement declares is offered as a control, not as a parameter to fill in
      Given a statement whose first run is refused for an unfilled period_granularity_seconds
      When the workbench shows the refusal
      Then the step is not listed among the parameters to give a value
      And a granularity control offers the steps the contract admits

    @integration
    Scenario: Choosing a step sends it beside the query rather than among its parameters
      Given the workbench is showing the granularity control
      When the member chooses a step and runs the query
      Then the request carries that step in its own field
      And no reserved name appears among the parameters sent

    @integration
    Scenario: A step too fine for the window is refused where the member chose it
      Given the workbench is showing the granularity control
      When the member chooses a step that would exceed the bucket ceiling
      Then the refusal is shown against the query

    @unit
    Scenario: Changing the granularity step marks the result stale and restores Run query
      Given a successful result for a submitted snapshot at one granularity step
      When the member picks a different granularity step
      Then the visible result is marked stale
      And the action reads Run query again

    @unit
    Scenario: Clearing the chosen step sends no step at all, not an empty one
      Given a submission that had chosen a granularity step
      When the member clears the step and runs the query
      Then the request carries no granularity field at all
      And it is not sent as a present field holding no value

  Rule: Results preserve transport fields, ordering, and readable states

    @integration
    Scenario: Backend failures keep their code-specific presentation
      Given a parse, policy, missing-parameter, unavailable, or database-timeout refusal with structured metadata
      When the result pane renders it
      Then registry copy, source position, violated rule, missing names, unavailable state, or timeout advice is preserved as applicable

    @integration
    Scenario: A result opens in a native table with deliberate states
      Given a response containing columns, rows, statistics, diagnostics, truncation, and followsTimeWindow
      When the first result, an empty result, a loading result, a stale result, or a refusal is rendered
      Then each state has an intentional presentation, Table is selected first, and every response field remains available to the views

    @integration
    Scenario: Table order and scale are stable
      Given a result with ordered ClickHouse columns and up to 10,000 rows
      When the member scrolls the virtualized semantic table
      Then columns and rows retain backend order, headers remain usable, and wide results scroll without page breakage

    @unit
    Scenario: Cell formatting is lossless and distinguishes absence
      Given cells containing missing keys, null, empty strings, zero, NaN, Infinity, arrays, maps, tuples, 64-bit integers, and high-precision decimals
      When the member reads or copies them
      Then each state remains distinguishable, structured values are bounded on screen, and exact wire digits are copied without lossy numeric coercion

    @integration
    Scenario: Duplicate columns, truncation, statistics, and diagnostics are honest
      Given duplicate column names, a byte- or row-truncated result, statistics, and diagnostics
      When the table and chart views render
      Then duplicates and actual returned-row counts are called out, rows returned/elapsed/rows read/bytes read are shown, and every diagnostic remains visible in both modes

    @e2e
    Scenario: A real browser carries a query from editor to native table
      When the member writes LangWatchQL and runs it
      Then the returned rows and result statistics appear in the native table without a second request caused by viewing the result

  Rule: Chart mode is a controlled reading of the same result

    @integration
    Scenario: View changes and specification edits do not rerun SQL
      Given a successful result
      When the member switches between Table, Chart, and Specification or edits the chart specification
      Then the same result is read, the specification is revalidated and rerendered, and no query request is issued

    @integration
    Scenario: Chart mode preserves data and offers an accessible table fallback
      Given categorical or time-bucketed multi-series result data
      When a valid specification renders and the member changes data, size, or colour mode
      Then the registered result dataset is updated, the chart remains responsive and themed, tooltips and accessible naming remain available, and Table remains the non-visual fallback

    @integration
    Scenario: Starter specifications follow new data until the member edits them
      Given a chart using an untouched starter specification
      When Reload returns different result columns
      Then the starter reshapes to those columns, but an edited specification is never replaced

    @integration
    Scenario: Chart failures are explicit and do not discard the table
      Given invalid JSON, schema or policy failures, unknown fields or datasets, excessive data, empty or non-finite values, or Vega runtime failures
      When Chart mode handles them
      Then it names the intentional failure or warning, never renders a blank chart, and leaves every returned row available in Table mode

    @unit
    Scenario: Vega dependencies and browser runtime stay behind the lazy boundary
      Given the application dependency manifest and source graph
      When entry and unrelated route chunks are inspected
      Then Vega, Vega-Lite, vega-embed, and the generated validator are exact compatible dependencies loaded only through Lazy Chart mode
      And policy modules import without React, DOM, or browser runtime side effects

    @e2e
    Scenario: The chart renders under CSP without eval
      Given a hardened Content Security Policy without unsafe-eval
      When a valid specification renders
      Then Vega's interpreter renders it and disabling the interpreter causes the observed policy failure

  Rule: Vega validation fails closed and never loads caller resources

    @unit
    Scenario: Only supported parsed specifications are admitted
      Given a candidate specification
      When it is a URL, non-object, unsupported schema version, or invalid against the bundled Vega-Lite v6 schema
      Then validation refuses it with a stable code, JSON path, and repairable message

    @unit
    Scenario: Data and runtime escape hatches are rejected
      Given a specification containing inline values, caller datasets, URL data/spec/config/patches, image marks, URL encodings, or embed usermeta options at any depth
      When it is validated
      Then it is refused before reaching Vega

    @unit
    Scenario: Policy validates names, fields, transforms, and complexity
      Given registered named datasets and the centralized size, depth, unit-view, layer, transform, expression, parameter, lookup, and row limits
      When a specification uses unknown names or fields, unsupported transforms or expressions, invalid lookup sources, or crosses a limit
      Then it is refused with the relevant dataset, field, rule, or limit named
      And values at each ceiling remain admissible

    @unit
    Scenario: The adversarial corpus and multi-dataset renderer contract stay covered
      Given the reviewed corpus of deep composition, long expressions, nested resource paths, lookup bypasses, and runtime options
      When each fixture is validated and a renderer is supplied multiple registered datasets
      Then every adversarial fixture is refused and valid branches resolve each named dataset without weakening the first workbench's query_result injection

    @integration
    Scenario: No renderer path performs network or file loading
      Given a specification that could request a resource
      When validation and rendering are attempted while browser network activity is recorded
      Then static policy and the repository-owned loader reject it, no credential or authenticated URL reaches Vega, and no request is made

    @integration
    Scenario: Chart controls expose no unsafe embed actions
      When a chart renders
      Then source, compiled-spec, export, and open-in-editor actions are not exposed
