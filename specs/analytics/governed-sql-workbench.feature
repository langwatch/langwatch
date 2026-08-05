Feature: Governed SQL query workbench — native tables and governed Vega-Lite charts

  As an authorized LangWatch project member
  I want to discover the governed analytics schema, write native ClickHouse SQL,
  inspect results in a native virtualized table, and optionally chart them with
  a governed Vega-Lite specification
  So that I can answer analytical questions beyond the built-in charts without
  weakening tenant isolation, content gating, or the application's security policy

  Issue: #6577. Builds on the governed analytics SQL API (#6480, PR #6486).
  The backend owns SQL parsing, validation, tenant isolation, content gating,
  resource limits, result truncation, and analytical diagnostics. The frontend
  owns editing, request state, table presentation, Vega-Lite policy,
  named-dataset injection, theming, accessibility, and chart runtime
  containment. Query execution and visualization stay separate: no
  visualization syntax in SQL, no weakening of the governed SQL service.

  Background:
    Given a project whose governed analytics SQL API is available to the signed-in member

  # ---------------------------------------------------------------------------
  # Availability gating and scope guards
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The workbench is unreachable while governed SQL is not provisioned
    Given a deployment where governed SQL provisioning and configuration are absent
    When the member looks for the Custom query surface
    Then the navigation entry is not offered
    And opening the route directly renders the backend's unavailable state
    And no client-side environment variable can force the surface on

  @integration
  Scenario: An authorized member opens Custom query and sees only their live governed schema
    When the member opens the Custom query page
    Then the page identifies the editor as governed ClickHouse SQL
    And the schema browser lists exactly the datasets the schema endpoint returned for them
    And nothing implies access to arbitrary ClickHouse databases or tables

  @unit
  Scenario: The workbench ships no polling, persistence, export, or agent surface
    Given the workbench feature's source
    When it is inspected for schedules, refresh intervals, saved queries, saved
      specs, dashboards, sharing links, export, source display, Langy, MCP, or
      external connectors
    Then none is present

  @unit
  Scenario: The frontend does not implement a second SQL validator
    Given a draft whose SQL the backend would reject
    When the member runs the query
    Then the exact statement is submitted unmodified
    And the backend's rejection is what the member sees

  # ---------------------------------------------------------------------------
  # Schema browser and editor assistance
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The live schema response drives the browser and completion model
    Given a schema response with datasets, columns, types, descriptions, units,
      grain, join keys, freshness, time columns, and example SQL
    When it is mapped for the schema browser and editor assistance
    Then every rendered dataset and column comes from the response
    And no dataset, column, or physical table name is hard-coded in the frontend

  @integration
  Scenario: A dataset's documentation is browsable
    When the member expands a dataset in the schema browser
    Then its description, grain, freshness, time column, join keys, and example SQL are shown
    And its columns are shown with type, description, and unit

  @integration
  Scenario: Unavailable columns are visibly disabled without exposing hidden values
    Given the schema response marks a content-gated column unavailable to this member
    When the member browses that dataset
    Then the column is omitted or visibly disabled
    And no gated value or hidden detail is exposed

  @integration
  Scenario: The member inserts schema elements into the editor
    When the member picks a dataset name, column name, or example query in the browser
    Then it can be inserted into the editor or copied

  @integration
  Scenario: Monaco assistance derives from the same schema response
    When the member invokes completion or hovers a governed identifier in the editor
    Then the suggestions and hover details come from the live schema response

  @integration
  Scenario: A search narrows the schema browser
    Given a schema with many datasets and columns
    When the member searches the schema browser
    Then only matching datasets and columns remain visible

  # ---------------------------------------------------------------------------
  # Request state: draft, submitted, result
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Run query submits the draft and becomes Reload on success
    Given a draft SQL statement and parameters
    When the member runs the query and it succeeds
    Then the submitted snapshot equals that draft
    And the action reads Reload while the draft still matches the submitted snapshot

  @unit
  Scenario: Editing SQL or parameters marks the result stale and restores Run query
    Given a successful result for a submitted snapshot
    When the member edits the SQL or the parameters
    Then the visible result is marked stale
    And the action reads Run query again

  @integration
  Scenario: A stale result stays labelled as belonging to the previous submission
    Given a result marked stale by an edit
    When the member inspects the result pane
    Then the result is visibly labelled as produced by the previous submission
    And it is never presented as current for the draft

  @unit
  Scenario: Reload reruns the submitted snapshot exactly
    Given a submitted snapshot differing from the current draft
    When the member reloads
    Then the request carries the submitted SQL and parameters byte-for-byte
    And the draft is not what is executed

  @unit
  Scenario: Duplicate submissions are prevented while a request is in flight
    Given a governed query in flight
    When the member tries to run or reload again
    Then no second request is issued until the first settles

  @integration
  Scenario: Reload is manual only
    Given a successful result
    When time passes and the member types in the editor
    Then no request is issued without an explicit Run query or Reload
    And no polling, interval, schedule, or background rerun exists

  @integration
  Scenario: Named scalar parameters accompany the SQL without rewriting it
    Given a draft using parameter placeholders and named scalar values
    When the member runs the query
    Then the request carries the SQL unmodified and the parameters as named scalars
    And only the request shape is validated locally

  @integration
  Scenario: A backend query error is presented through the handled-error registry
    Given the backend refuses the submitted SQL with a stable error code
    When the result pane renders the failure
    Then the member reads the registry copy for that code, not a raw wire message
    And repairable location details the public response provides are preserved

  # ---------------------------------------------------------------------------
  # Native result table
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The first successful result opens in Table mode
    When the member's first query succeeds
    Then the result renders as a table
    And Chart mode is offered but not selected

  @integration
  Scenario: Columns come from the response in backend order and expose ClickHouse types
    Given a result whose columns arrive in a defined order with ClickHouse types
    When the table renders
    Then the columns appear in exactly that order
    And each column's ClickHouse type is visible in its header or details

  @integration
  Scenario: A 10,000-row result stays usable in a semantic virtualized table
    Given a result at the backend's row ceiling
    When the member scrolls and navigates the table
    Then only a bounded window of rows is materialized in the document
    And the table remains a semantic table with headers visible while scrolling
    And wide results scroll horizontally without breaking the page

  @integration
  Scenario: Structured values render bounded, readable, and copyable
    Given a result containing arrays, maps, tuples, and nested objects
    When those cells render
    Then each shows a bounded, readable representation
    And the member can copy the full underlying value

  @unit
  Scenario: Nothing coerces distinct emptiness and non-finite values together
    Given cells holding null, a missing key, zero, an empty string, NaN, and Infinity
    When the table formats them
    Then each renders distinguishably from the others
    And no value is silently displayed as another

  @integration
  Scenario: The table has intentional loading, empty, error, stale, and truncated states
    When a query is in flight, returns zero rows, fails, is stale, or was truncated
    Then each state renders a deliberate presentation rather than a blank or misleading table

  @integration
  Scenario: Result statistics render beneath the result
    Given a successful result
    When the result pane renders
    Then rows returned, elapsed time, rows read, and bytes read are shown compactly

  @integration
  Scenario: Backend diagnostics stay visible in both result modes
    Given a response carrying diagnostics
    When the member views the result as a table and as a chart
    Then every diagnostic is displayed unchanged adjacent to either mode
    And a truncation diagnostic is visually prominent in both

  @e2e
  Scenario: A governed query flows from editor to native table in a real browser
    When the member writes governed SQL, runs it, and waits for the response
    Then the returned rows appear in the native result table with statistics

  # ---------------------------------------------------------------------------
  # Result modes
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Switching between Table and Chart never reruns SQL
    Given a successful result
    When the member switches to Chart mode and back
    Then no query request is issued

  @unit
  Scenario: Editing the chart specification never reruns SQL
    Given a rendered chart
    When the member edits the Vega-Lite specification
    Then the spec is revalidated and the chart rerendered
    And no query request is issued

  # ---------------------------------------------------------------------------
  # Vega dependencies, loading, and CSP
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The Vega dependency set is pinned and compatible
    Given the application's dependency manifest
    When the Vega packages are inspected
    Then react-vega, vega, vega-lite, and vega-embed are direct, exact-pinned,
      mutually compatible versions recorded in the PR

  @integration
  Scenario: Vega loads lazily from Chart mode only
    Given the built application's bundles
    When the entry, Table-mode, and unrelated route chunks are inspected
    Then no Vega runtime code is present in them
    And the Vega runtime loads only when Chart mode is first entered

  @unit
  Scenario: Policy modules stay pure and server-import-safe
    Given the Vega-Lite validator and policy modules
    When they are imported outside a browser
    Then no React, DOM, or browser-only Vega runtime module is evaluated

  @e2e
  Scenario: The chart renders under the real application CSP without unsafe-eval
    Given the application served with its real Content Security Policy
    When a valid spec renders as a chart
    Then rendering succeeds using Vega's expression interpreter
    And a Function-constructor evaluator would have been blocked by that policy

  # ---------------------------------------------------------------------------
  # Vega-Lite validation policy (fail closed, structured errors)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A spec validates against the bundled official Vega-Lite v6 schema
    Given a candidate specification
    When it is validated
    Then the bundled official Vega-Lite v6 JSON Schema decides schema validity
    And no schema is fetched at runtime
    And every rejection carries a stable error code, a JSON path, and a repairable message

  @unit
  Scenario: Only a parsed JSON object of the supported version is accepted
    When a URL string, a non-object value, or a spec with an unsupported schema version is offered
    Then each is rejected with a stable error code
    And nothing is silently converted to the supported version

  @unit
  Scenario: Every data source must resolve to a registered named dataset
    When a spec references a data name that is not registered
    Then it is rejected naming the unknown dataset and the registered names

  @unit
  Scenario: Caller-supplied datasets and inline values are rejected
    When a spec carries a top-level datasets property or inline data values
    Then each is rejected before reaching Vega

  @unit
  Scenario: Every resource-loading path is rejected recursively
    When a spec at any nesting depth carries URL data, URL-backed lookup data,
      URL specs, config, or patches, an image mark, or a URL encoding
    Then each is rejected before reaching Vega

  @unit
  Scenario: Spec-controlled runtime options are rejected
    When a spec carries usermeta embed options or other runtime-option overrides
    Then it is rejected before reaching Vega

  @unit
  Scenario: Lookup is admitted only between registered datasets within limits
    When a lookup transform names another registered dataset within the row and transform limits
    Then it is admitted
    And a lookup naming an unregistered source or exceeding those limits is rejected

  @unit
  Scenario: Unknown transforms and expression features fail closed
    When a spec uses a transform or expression construct outside the allowlist
    Then it is rejected until reviewed, never passed through untested

  @unit
  Scenario: Field references are validated against the dataset that feeds them
    Given a spec whose branches read different registered datasets
    When a field reference does not exist in the dataset feeding its branch
    Then the rejection names the dataset and lists its available columns
    And fields created by allowed transforms are recognized downstream

  @unit
  Scenario: Every named complexity limit refuses just past its ceiling
    Given the centralized complexity limits for spec size, nesting depth, unit
      views, layers, transforms, expression sizes, interactive parameters, and
      dataset rows
    When a spec sits at a ceiling and another sits just past it
    Then the one at the ceiling is admitted and the one past it is refused
    And each refusal names the limit that was exceeded

  @unit
  Scenario: The adversarial corpus is refused
    Given fixtures for deep composition, excessive layers, facets and repeats,
      long expressions, oversized datasets, nested resource-loading paths,
      lookup bypasses, and caller runtime options
    When each fixture is validated
    Then every one is refused with its structured error

  @unit
  Scenario: The renderer contract accepts multiple registered named datasets
    Given a renderer given several registered named datasets and their columns
    When a spec reads more than one of them
    Then validation and rendering resolve each by name
    And the first workbench still supplies only the query result dataset

  # ---------------------------------------------------------------------------
  # Chart runtime containment
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A repository-owned loader refuses all network and file loading
    Given a spec that slipped past static validation with a loadable resource
    When the Vega view processes it
    Then the loader refuses the load
    And no browser credential, token, or authenticated URL is ever handed to Vega

  @e2e
  Scenario: Rejected and adversarial specs cause no network request
    Given the browser's network activity is being recorded
    When adversarial specs are validated and, where relevant, rendering is attempted
    Then no network request is triggered by any spec

  @integration
  Scenario: No embed actions are exposed
    When a chart renders
    Then no source, compiled spec, export, or open-in-editor action is available

  @integration
  Scenario: A chart over too much data refuses clearly and leaves the table available
    Given a result larger than the chart row ceiling
    When the member switches to Chart mode
    Then the chart refuses with the exceeded limit named
    And Table mode still shows every returned row
    And nothing is silently sampled, dropped, or aggregated

  # ---------------------------------------------------------------------------
  # Chart rendering and lifecycle
  # ---------------------------------------------------------------------------

  @e2e
  Scenario: A categorical governed result renders as a chart in a real browser
    Given a successful categorical governed SQL result
    When the member provides a valid bar specification over the query result dataset
    Then the chart renders from the registered dataset

  @integration
  Scenario: A time-bucketed multi-series result renders responsively with tooltips
    Given a successful time-bucketed, multi-series governed SQL result shape
    When a valid line specification renders
    Then the chart fits its container, responds to resize, and shows tooltips

  @integration
  Scenario: A data-only Reload updates the chart through the live view
    Given a rendered chart and a Reload returning changed rows
    When the new result arrives
    Then the registered dataset is updated through the running view
    And the working view is not torn down and rebuilt
    And no prior view or its resources leak

  @integration
  Scenario: Spec, size, and color-mode changes update the chart and unmount finalizes it
    Given a rendered chart
    When the spec changes, the container resizes, or the color mode flips
    Then the chart updates accordingly
    And unmounting, a policy failure, or an unrecoverable runtime error finalizes the view

  @integration
  Scenario: The chart follows LangWatch theming in light and dark modes
    When a chart renders in light mode and in dark mode
    Then fonts, backgrounds, axes, labels, legends, and palettes come from the
      application's resolved theme tokens and stay readable in both

  @integration
  Scenario: Chart failures are distinct intentional states, never a blank chart
    When a spec is invalid JSON, fails the schema, is rejected by policy, names
      an unknown dataset or field, exceeds a complexity limit, encodes only
      empty or missing values, or fails in Vega at compile or runtime
    Then each case renders its own intentional state naming the cause
    And no case renders a blank chart or crashes the page

  @integration
  Scenario: Values Vega cannot represent faithfully produce a warning, not a zero
    Given encoded values containing zero, null, missing, NaN, and infinite entries
    When the chart renders them
    Then values the encoding can represent are preserved
    And any value it cannot represent faithfully surfaces an explicit warning
      instead of being coerced

  @integration
  Scenario: The chart is accessible and does not trap focus
    When a chart renders
    Then it carries an accessible name and description
    And keyboard focus moves through the surrounding controls without being trapped
    And the Table tab remains the non-visual fallback for the same result

# --- AC Coverage Map ---
# Issue #6577 ACs → scenarios (grouped as in the issue body).
#
# Base and scope:
# AC "based on current #6486 head with exact base SHA recorded" → process AC,
#    recorded in the PR body (base branch issue6480/governed-analytics-sql-api-read-only,
#    base SHA recorded at PR-open time).
# AC "production navigation gated until provisioning available"
#   → Scenario: The workbench is unreachable while governed SQL is not provisioned
# AC "old LWQL parser, IR, branches, API types not used" → process AC, verified
#    in the PR diff (no LWQL import exists to reference); the behavioral shadow is
#   → Scenario: The frontend does not implement a second SQL validator
# AC "SQL grammar, parser, validator, tenant policy, row policies, catalog,
#    resource ceilings unchanged" → process AC, verified by the PR diff touching
#    no governed SQL backend module; the frontend half is
#   → Scenario: The frontend does not implement a second SQL validator
# AC "existing Recharts charts are not migrated" → process AC, verified by the
#    PR diff leaving Recharts components untouched.
# AC "polling, schedules, dashboards, persistence, sharing, export, Langy, MCP,
#    coding-agent tools, external connectors not added"
#   → Scenario: The workbench ships no polling, persistence, export, or agent surface
#   → Scenario: Reload is manual only
#
# Workbench:
# AC "authorized user opens Custom query and discovers only their live governed schema"
#   → Scenario: An authorized member opens Custom query and sees only their live governed schema
#   → Scenario: The live schema response drives the browser and completion model
# AC "Monaco provides SQL editing and schema-derived assistance without claiming
#    arbitrary ClickHouse access"
#   → Scenario: Monaco assistance derives from the same schema response
#   → Scenario: An authorized member opens Custom query and sees only their live governed schema
# AC "named scalar parameters without rewriting SQL in the browser"
#   → Scenario: Named scalar parameters accompany the SQL without rewriting it
# AC "Run query, Reload, in-flight, error, stale-result, submitted-snapshot behavior"
#   → Scenario: Run query submits the draft and becomes Reload on success
#   → Scenario: Reload reruns the submitted snapshot exactly
#   → Scenario: Duplicate submissions are prevented while a request is in flight
#   → Scenario: A backend query error is presented through the handled-error registry
# AC "editing SQL or parameters never leaves an old result looking current"
#   → Scenario: Editing SQL or parameters marks the result stale and restores Run query
#   → Scenario: A stale result stays labelled as belonging to the previous submission
# AC "Reload is manual; no automatic polling or interval"
#   → Scenario: Reload is manual only
#
# (schema browser requirements from the body, same group)
#   → Scenario: A dataset's documentation is browsable
#   → Scenario: Unavailable columns are visibly disabled without exposing hidden values
#   → Scenario: The member inserts schema elements into the editor
#   → Scenario: A search narrows the schema browser
#
# Table:
# AC "Table is the default result mode" → Scenario: The first successful result opens in Table mode
# AC "columns from backend response in backend order with ClickHouse types"
#   → Scenario: Columns come from the response in backend order and expose ClickHouse types
# AC "TanStack Table + Virtual + Chakra render semantic, virtualized,
#    horizontally scrollable results"
#   → Scenario: A 10,000-row result stays usable in a semantic virtualized table
# AC "structured values bounded, readable, copyable"
#   → Scenario: Structured values render bounded, readable, and copyable
# AC "null, missing, zero, empty, NaN, infinite not silently conflated"
#   → Scenario: Nothing coerces distinct emptiness and non-finite values together
# AC "usable at 10,000 rows with intentional loading/empty/error/stale/truncated states"
#   → Scenario: A 10,000-row result stays usable in a semantic virtualized table
#   → Scenario: The table has intentional loading, empty, error, stale, and truncated states
# AC "statistics and every backend diagnostic visible in both modes"
#   → Scenario: Result statistics render beneath the result
#   → Scenario: Backend diagnostics stay visible in both result modes
#
# Vega dependencies and loading:
# AC "compatible pinned versions recorded in the PR"
#   → Scenario: The Vega dependency set is pinned and compatible (plus the PR-body record)
# AC "official React wrapper behind a small LangWatch-owned boundary" → process AC,
#    verified in the PR diff; its behavior is exercised by every chart scenario here.
# AC "Vega lazy-loaded only from Chart mode, absent from unrelated bundles"
#   → Scenario: Vega loads lazily from Chart mode only
# AC "SSR/server imports do not evaluate DOM-dependent Vega modules"
#   → Scenario: Policy modules stay pure and server-import-safe
# AC "no unsafe-eval or weaker CSP required"
#   → Scenario: The chart renders under the real application CSP without unsafe-eval
#
# Vega governance:
# AC "specs validate against the bundled official v6 schema"
#   → Scenario: A spec validates against the bundled official Vega-Lite v6 schema
# AC "only parsed JSON objects for the supported schema version"
#   → Scenario: Only a parsed JSON object of the supported version is accepted
# AC "all data sources resolve to registered named datasets"
#   → Scenario: Every data source must resolve to a registered named dataset
# AC "caller datasets, inline values, URL data/config/patches, external lookup
#    data, images/URL encodings, spec-controlled embed options rejected"
#   → Scenario: Caller-supplied datasets and inline values are rejected
#   → Scenario: Every resource-loading path is rejected recursively
#   → Scenario: Spec-controlled runtime options are rejected
#   → Scenario: Lookup is admitted only between registered datasets within limits
# AC "no-network loader prevents outbound/file loads even if static validation misses"
#   → Scenario: A repository-owned loader refuses all network and file loading
# AC "actions disabled, no editor/export/source surface"
#   → Scenario: No embed actions are exposed
# AC "Vega expressions use CSP interpreter mode under a browser test with the real policy"
#   → Scenario: The chart renders under the real application CSP without unsafe-eval
# AC "source and transform-created fields validated against the correct dataset"
#   → Scenario: Field references are validated against the dataset that feeds them
# AC "unknown transforms and expression features fail closed"
#   → Scenario: Unknown transforms and expression features fail closed
# AC "every named complexity limit has boundary and adversarial tests"
#   → Scenario: Every named complexity limit refuses just past its ceiling
#   → Scenario: The adversarial corpus is refused
# AC "a chart over too much data refuses clearly, table available, never samples"
#   → Scenario: A chart over too much data refuses clearly and leaves the table available
# AC "renderer accepts multiple registered named datasets"
#   → Scenario: The renderer contract accepts multiple registered named datasets
#
# Rendering and UX:
# AC "categorical governed SQL result renders from query_result"
#   → Scenario: A categorical governed result renders as a chart in a real browser
# AC "time-bucketed multi-series renders responsively with tooltips"
#   → Scenario: A time-bucketed multi-series result renders responsively with tooltips
# AC "data-only Reload updates named data through the View API without leaking the old view"
#   → Scenario: A data-only Reload updates the chart through the live view
# AC "spec, size, color-mode changes update; unmount finalizes"
#   → Scenario: Spec, size, and color-mode changes update the chart and unmount finalizes it
# AC "LangWatch theming readable in light and dark"
#   → Scenario: The chart follows LangWatch theming in light and dark modes
# AC "validation, policy, complexity, empty, all-missing, runtime failures have
#    intentional states rather than a blank chart or page crash"
#   → Scenario: Chart failures are distinct intentional states, never a blank chart
#   → Scenario: Values Vega cannot represent faithfully produce a warning, not a zero
# AC "accessible name/description, no keyboard focus trap"
#   → Scenario: The chart is accessible and does not trap focus
# AC "backend diagnostics, especially truncation and fanout, not concealed by Chart mode"
#   → Scenario: Backend diagnostics stay visible in both result modes
#
# Result-mode rules from the body (same group):
#   → Scenario: Switching between Table and Chart never reruns SQL
#   → Scenario: Editing the chart specification never reruns SQL
#
# Tests and evidence (meta-ACs about coverage; each names the scenarios that
# discharge it at the required level):
# AC "unit tests cover request-state transitions, schema mapping, table
#    formatting, every visualization policy rule" → the @unit scenarios above.
# AC "adversarial fixtures cover deep composition, layers/facets/repeats, long
#    expressions, large datasets, nested resource paths, lookup bypasses,
#    caller runtime options" → Scenario: The adversarial corpus is refused
# AC "component tests cover virtualization, structured values, themes,
#    data/spec updates, cleanup, empty/error states, stale results,
#    diagnostics, truncation" → the @integration table and chart scenarios above.
# AC "browser tests cover request-to-table and request-to-chart"
#   → Scenario: A governed query flows from editor to native table in a real browser
#   → Scenario: A categorical governed result renders as a chart in a real browser
# AC "browser egress test proves rejected specs cause no network request"
#   → Scenario: Rejected and adversarial specs cause no network request
# AC "real-CSP browser test proves the chart works without unsafe-eval"
#   → Scenario: The chart renders under the real application CSP without unsafe-eval
# AC "existing #6486 suites and application gates remain green" → process AC,
#    proven by the CI run on the PR.
