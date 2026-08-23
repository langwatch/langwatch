Feature: LangWatchQL query workbench — native tables and LangWatchQL Vega-Lite charts

  As an authorized LangWatch project member
  I want to discover the LangWatchQL analytics schema, write native ClickHouse SQL,
  inspect results in a native virtualized table, and optionally chart them with
  a LangWatchQL Vega-Lite specification
  So that I can answer analytical questions beyond the built-in charts without
  weakening tenant isolation, content gating, or the application's security policy

  Issue: #6577. Builds on the LangWatchQL analytics SQL API (#6480, PR #6486).
  The backend owns SQL parsing, validation, tenant isolation, content gating,
  resource limits, result truncation, and analytical diagnostics. The frontend
  owns editing, request state, table presentation, Vega-Lite policy,
  named-dataset injection, theming, accessibility, and chart runtime
  containment. Query execution and visualization stay separate: no
  visualization syntax in SQL, no weakening of the LangWatchQL service.

  Background:
    Given a project whose LangWatchQL analytics SQL API is available to the signed-in member

  # ---------------------------------------------------------------------------
  # Availability gating and scope guards
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The workbench is unreachable while LangWatchQL is not provisioned
    Given a deployment where LangWatchQL provisioning and configuration are absent
    When the member looks for the Custom query surface
    Then the navigation entry is not offered
    And opening the route directly renders the backend's unavailable state
    And no client-side environment variable can force the surface on

  @integration
  Scenario: The whole surface stays dark until the experimental feature switch is on
    Given the LangWatchQL feature switch is off for the project
    When the member looks for the Custom query surface
    Then availability answers unavailable, so neither the navigation entry nor the page offers the workbench
    And the schema and query endpoints refuse the request with a named, customer-safe refusal
    And the switch is evaluated on the server, so nothing in the browser can force the surface on

  @integration
  Scenario: An organization-scoped rule can switch the workbench on
    Given no environment override for the feature switch
    And a stored rule enabling the switch for the project's organization
    When the switch is evaluated for any of the surface's endpoints
    Then it is evaluated with the project's organization, so the rule matches and the surface is on

  @integration
  Scenario: An authorized member opens Custom query and sees only their live LangWatchQL schema
    When the member opens the Custom query page
    Then the page identifies the surface as LangWatchQL and project-scoped
    And the schema browser lists exactly the datasets the schema endpoint returned for them
    And nothing implies access to arbitrary ClickHouse databases or tables

  @integration
  Scenario: A member without the analytics permission cannot reach the workbench
    Given a signed-in member whose role lacks the analytics permission
    When they look for the Custom query surface
    Then the navigation entry is not offered to them
    And opening the route directly renders the permission-denied guard, not the workbench

  # Amended by #6582 slice 2, which added saving a chart to the member's own
  # project. That is server-side, explicitly invoked, and LangWatchQL by the same
  # validators a run passes — so it is not the thing this scenario forbids. What
  # it forbids is unchanged: work the member did not ask for, state the browser
  # keeps behind their back, and a surface an agent can reach.
  @unit
  Scenario: The workbench ships no polling, browser-side persistence, export, or agent surface
    Given the workbench feature's source
    When it is inspected for schedules, refresh intervals, browser storage,
      sharing links, export, source display, Langy, MCP, or external connectors
    Then none is present
    And the specification the member is editing is never written anywhere by the
      chart surface itself

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
    When the member invokes completion or hovers a LangWatchQL identifier in the editor
    Then the suggestions and hover details come from the live schema response

  @unit
  Scenario: Typing a keyword offers the keyword
    When the member starts typing a statement in the editor
    Then SQL keywords and reviewed ClickHouse functions are offered alongside schema names
    And nothing that could write, define, or grant is ever suggested

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
    Given a LangWatchQL query in flight
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

  @unit
  Scenario: An aborted request never updates the result pane
    Given a LangWatchQL query in flight
    When the member leaves the workbench or the request is cancelled
    Then the request is aborted using the existing cancellation pattern
    And a response arriving after the abort does not change the visible result

  # ---------------------------------------------------------------------------
  # Backend error paths — each coded failure has its own presentation
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A statement the validator cannot parse renders registry copy at its location
    Given the backend refuses the submitted SQL as unparseable with a line and column
    When the result pane renders the failure
    Then the member reads the registry copy for that code, not the raw wire message
    And the editor marks the offending line and column
    And a refusal that carries no location still renders the full registry copy

  @integration
  Scenario: A statement the policy refuses names what to change
    Given the backend refuses the submitted SQL as not permitted, naming the violated rule
    When the result pane renders the failure
    Then the member reads registry copy identifying what the policy refused
    And the named rule details the response provides are preserved

  @integration
  Scenario: A missing bound parameter is reported against the parameter editor
    Given the submitted SQL declares a parameter the request left unset
    When the backend refuses it naming the missing parameters
    Then the failure is shown at the parameter editor listing the missing names
    And it is not reduced to a detached generic toast

  @integration
  Scenario: An unprovisioned deployment renders the unavailable state on query
    Given LangWatchQL is not provisioned so the query endpoint refuses as unavailable
    When the member runs a query
    Then the workbench renders the backend's unavailable presentation
    And it does not retry automatically

  @integration
  Scenario: A query that outruns the database ceiling renders a distinct timeout state
    Given the submitted query is cancelled by the database's execution-time ceiling
    When the result pane renders the failure
    Then the member reads a timeout presentation distinct from the generic error
    And it suggests narrowing the query rather than blaming the platform

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

  @unit
  Scenario: Wide integers and decimals keep every digit
    Given a result carrying a 64-bit integer beyond safe float precision and a high-precision decimal
    When the table renders and the member copies the cells
    Then the exact digit strings the response carried are shown and copied
    And no value is rounded through a lossy float

  @unit
  Scenario: Duplicate result column names are surfaced, not silently merged
    Given a result whose columns list the same name twice
    When the table renders
    Then the member is warned that the duplicated name collapses to one value per row
    And nothing pretends the two columns were independently preserved

  @integration
  Scenario: The truncation banner tells the truth about how much arrived
    Given a wide result the byte ceiling truncated well below the row ceiling
    When the truncated state renders
    Then the banner cites the actual number of returned rows
    And it never claims a fixed row limit that was not the cause

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
  Scenario: A LangWatchQL query flows from editor to native table in a real browser
    When the member writes LangWatchQL, runs it, and waits for the response
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

  @integration
  Scenario: The result offers Table, Chart, and Specification readings
    Given a successful result
    When the member opens the result
    Then Table, Chart, and Specification are offered as views of the same result
    And the Specification view edits the same specification the Chart view draws

  @integration
  Scenario: The specification view names what the chart policy accepts
    Given the Specification view is open
    When the member reads the panel beside the editor
    Then it says whether the current specification is valid or refused
    And it names what the policy accepts, including the query_result dataset name

  @integration
  Scenario: The visible answer wears a state chip naming where it stands
    Given a submission has settled
    When the result header renders
    Then a current result is labelled Current, a truncated one Partial,
      an outdated one Previous submission, a refusal Refused,
      and a timeout Timed out

  @unit
  Scenario: Cancelling an in-flight run keeps the previous result
    Given a result on screen and a newer submission in flight
    When the member cancels the run
    Then the in-flight request is abandoned
    And the previous result stays on screen unchanged

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

  # The application's production CSP still carries unsafe-eval for unrelated
  # scripts and dev mode serves no CSP header at all, so "under the real CSP"
  # would be vacuously green. The test therefore serves the page under a
  # hardened policy without unsafe-eval — strictly stronger than the deployed
  # one — and proves it can go red by forcing the Function-constructor
  # evaluator under the same policy.
  @e2e
  Scenario: The chart renders under a CSP that forbids eval
    Given the workbench served under a Content Security Policy without unsafe-eval
    When a valid spec renders as a chart
    Then rendering succeeds using Vega's expression interpreter
    And the same page with the interpreter disabled fails with a policy violation,
      proving the test observes the evaluator

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
  Scenario: A categorical LangWatchQL result renders as a chart in a real browser
    Given a successful categorical LangWatchQL result
    When the member provides a valid bar specification over the query result dataset
    Then the chart renders from the registered dataset

  @integration
  Scenario: A time-bucketed multi-series result renders responsively with tooltips
    Given a successful time-bucketed, multi-series LangWatchQL result shape
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
  Scenario: A new result reshapes the starter specification until it is edited
    Given a chart drawn from the starter specification, untouched
    When a run returns a result with different columns
    Then the chart redraws from a starter specification over the new columns
    But a specification the member has edited is never replaced by a new result

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

  # ---------------------------------------------------------------------------
  # The time window — reserved period parameters (#6631)
  #
  # A statement opts into the page's period by declaring `{period_start:DateTime}`
  # and `{period_end:DateTime}`. The surface owns those two names: it supplies
  # their values and refuses a caller that tries to. A statement that declares
  # neither is allowed and is labelled as not following the period, because the
  # failure this contract exists to prevent is two charts on one dashboard
  # silently showing different periods.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A statement declaring the reserved period parameters is given the surface's window
    Given SQL declaring period_start and period_end as ClickHouse date-times
    And the surface supplies the window the member is looking at
    When the member runs the query
    Then the values the database is bound with are that window
    And the member supplied neither of them

  @unit
  Scenario: A statement declaring only one reserved period parameter is given that one
    Given SQL declaring period_start and no period_end
    When the member runs the query with the surface's window
    Then period_start is bound to the window's start
    And no period_end value is sent

  @unit
  Scenario: A caller that supplies a reserved period parameter itself is refused
    Given SQL declaring the reserved period parameters
    When the request carries a value for period_start of its own
    Then it is refused with error code lwql_reserved_parameter_supplied
    And nothing reaches the database

  @unit
  Scenario: The refusal names the reserved parameter the caller actually supplied
    Given a request refused for supplying a reserved parameter of its own
    When the workbench shows the refusal
    Then the copy names the parameter that was supplied
    And it does not name a reserved parameter the request never sent

  @unit
  Scenario: A reserved period parameter declared as anything but a date-time is refused
    Given SQL declaring period_start as a string
    When the statement is validated
    Then it is refused with error code lwql_reserved_parameter_type
    And the refusal comes from the validation step both running and saving pass through

  @unit
  Scenario: A statement with no period parameters runs, and says so
    Given SQL declaring neither reserved period parameter
    When the member runs it
    Then it executes unchanged
    And the answer reports that the statement does not follow the page period

  @unit
  Scenario: A period-aware statement run with no window names what is unset
    Given SQL declaring the reserved period parameters
    When it is run with no time window at all
    Then it is refused with error code lwql_parameter_missing naming them
    And validating that same statement is not refused, because the window is the surface's to supply

  @unit
  Scenario: The injected window is a UTC ClickHouse date-time, not an ISO-8601 instant
    Given an instant the browser holds in its own zone
    When it is formatted for the database
    Then it reads as year-month-day hours:minutes:seconds in UTC
    And it carries no zone designator or sub-second part the date-time binding would refuse

  @integration
  Scenario: The window the surface sends is the window the database reads
    Given rows recorded at a known instant
    When a period-aware statement runs for a window containing that instant
    Then those rows are returned
    And the same statement run for a window that does not contain it returns none

  @integration
  Scenario: The period is half-open, so the start instant is included and the end instant is not
    Given a row recorded exactly at a known instant
    When the window starts at that instant, the row is returned
    And when the window ends at that instant, the row is not returned

  @integration
  Scenario: The workbench fills the period parameters from the page's period selector
    Given a page whose period selector names a window
    When the member opens the workbench
    Then the time window shown is that window, in the format the database is bound with
    And a page carrying a different period shows that one instead

  @integration
  Scenario: A one-off window override is what runs, and survives a re-run
    Given the member overrides the window the page period seeded
    When they run the query and then run it again
    Then both requests carry the overridden window
    And it is never sent as one of their own named parameters

  @integration
  Scenario: The schema browser names the reserved period parameters where SQL is written
    When the member reads the schema browser
    Then it names period_start and period_end and the half-open interval they describe

# --- AC Coverage Map ---
# Issue #6577 ACs → scenarios (grouped as in the issue body).
#
# Base and scope:
# AC "based on current #6486 head with exact base SHA recorded" → process AC,
#    recorded in the PR body (base branch issue6480/lwql-analytics-sql-api-read-only,
#    base SHA recorded at PR-open time).
# AC "production navigation gated until provisioning available"
#   → Scenario: The workbench is unreachable while LangWatchQL is not provisioned
# AC "old LWQL parser, IR, branches, API types not used" → process AC, verified
#    in the PR diff (no LWQL import exists to reference); the behavioral shadow is
#   → Scenario: The frontend does not implement a second SQL validator
# AC "SQL grammar, parser, validator, tenant policy, row policies, catalog,
#    resource ceilings unchanged" → process AC, verified by the PR diff touching
#    no LangWatchQL backend module; the frontend half is
#   → Scenario: The frontend does not implement a second SQL validator
# AC "existing Recharts charts are not migrated" → process AC, verified by the
#    PR diff leaving Recharts components untouched.
# AC "polling, schedules, dashboards, persistence, sharing, export, Langy, MCP,
#    coding-agent tools, external connectors not added"
#   → Scenario: The workbench ships no polling, browser-side persistence, export, or agent surface
#     (the persistence half of this AC was superseded by #6582 slice 2, which
#     added saving deliberately; the scenario now guards the rest)
#   → Scenario: Reload is manual only
#
# Workbench:
# AC "authorized user opens Custom query and discovers only their live LangWatchQL schema"
#   → Scenario: An authorized member opens Custom query and sees only their live LangWatchQL schema
#   → Scenario: The live schema response drives the browser and completion model
# AC "Monaco provides SQL editing and schema-derived assistance without claiming
#    arbitrary ClickHouse access"
#   → Scenario: Monaco assistance derives from the same schema response
#   → Scenario: An authorized member opens Custom query and sees only their live LangWatchQL schema
# AC "named scalar parameters without rewriting SQL in the browser"
#   → Scenario: Named scalar parameters accompany the SQL without rewriting it
# AC "Run query, Reload, in-flight, error, stale-result, submitted-snapshot behavior"
#   → Scenario: Run query submits the draft and becomes Reload on success
#   → Scenario: Reload reruns the submitted snapshot exactly
#   → Scenario: Duplicate submissions are prevented while a request is in flight
#   → Scenario: A statement the validator cannot parse renders registry copy at its location
#   → Scenario: A statement the policy refuses names what to change
#   → Scenario: A query that outruns the database ceiling renders a distinct timeout state
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
#   → Scenario: The chart renders under a CSP that forbids eval
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
#   → Scenario: The chart renders under a CSP that forbids eval
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
# AC "categorical LangWatchQL result renders from query_result"
#   → Scenario: A categorical LangWatchQL result renders as a chart in a real browser
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
#   → Scenario: A LangWatchQL query flows from editor to native table in a real browser
#   → Scenario: A categorical LangWatchQL result renders as a chart in a real browser
# AC "browser egress test proves rejected specs cause no network request"
#   → Scenario: Rejected and adversarial specs cause no network request
# AC "real-CSP browser test proves the chart works without unsafe-eval"
#   → Scenario: The chart renders under a CSP that forbids eval
# AC "existing #6486 suites and application gates remain green" → process AC,
#    proven by the CI run on the PR.
#
# Issue #6631 ("wire the dashboard/workbench time window into LangWatchQL as
# standard start/end parameters"). Its ACs, in the order the issue's plan states
# them:
#
# AC1 "a statement declaring both reserved names runs with no explicit values,
#     and the rows change when the period changes"
#   → Scenario: A statement declaring the reserved period parameters is given the surface's window
#   → Scenario: The window the surface sends is the window the database reads
# AC2 "the same statement submitted with a reserved name in `parameters` is
#     refused and does not execute"
#   → Scenario: A caller that supplies a reserved period parameter itself is refused
# AC3 "`{period_start:String}` is refused at validate time, so it is refused at
#     save as well as at run"
#   → Scenario: A reserved period parameter declared as anything but a date-time is refused
# AC4 "a statement declaring neither reserved name executes unchanged, and the
#     answer reports followsTimeWindow: false"
#   → Scenario: A statement with no period parameters runs, and says so
# AC5 "injected values are YYYY-MM-DD HH:MM:SS UTC"
#   → Scenario: The injected window is a UTC ClickHouse date-time, not an ISO-8601 instant
#   → Scenario: The window the surface sends is the window the database reads
# AC6 "the interval is half-open"
#   → Scenario: The period is half-open, so the start instant is included and the end instant is not
# AC7 "the workbench pre-fills both from the page period; changing the period
#     changes them; a member override survives a re-run"
#   → Scenario: The workbench fills the period parameters from the page's period selector
#   → Scenario: A one-off window override is what runs, and survives a re-run
# AC8 "each new code has a presentation entry and a remediation entry" → guarded
#    by `features/errors/logic/__tests__/codes.unit.test.ts` and by the
#    exhaustive `satisfies` clause in `presentation.ts`, which is a typecheck
#    failure rather than a behaviour this file could describe.
#
# The surface-side half of the contract that is not an AC of its own:
#   → Scenario: A statement declaring only one reserved period parameter is given that one
#   → Scenario: A period-aware statement run with no window names what is unset
#   → Scenario: The schema browser names the reserved period parameters where SQL is written

# --- Granularity contract (#6713 slice 3, S1): the surface-owned bucket size ---
#
# A statement may declare `{period_granularity_seconds:UInt32}` and use it as
# the multiplier of a fixed-unit interval -- `INTERVAL
# {period_granularity_seconds:UInt32} SECOND` -- because ClickHouse compiles an
# interval unit to a function name, so only the multiplier can be a bound value.
#
# AC1 "a chart declaring the parameter runs at the step the surface supplies"
#   → Scenario: A statement declaring the granularity parameter runs at the step the workbench supplies
#   → Scenario: A granularity declared with no step supplied runs on its own authored bucketing
# AC2 "a caller-supplied value for a reserved name is refused" (granularity half)
#   → Scenario: A caller that supplies period_granularity_seconds itself is refused
# AC3 "the declaration must be UInt32"
#   → Scenario: The granularity parameter declared as anything but UInt32 is refused
#   → Scenario: A zero or fractional step is refused as a wrong declaration
# AC4 "declaring granularity requires declaring both period bounds, checked at save"
#   → Scenario: A saved chart declaring granularity without both period parameters is refused at save
#   → Scenario: A granularity declared alongside a mistyped period bound is refused at save
# AC5 "a window finer than the bucket ceiling is refused on caller-owned surfaces"
#   → Scenario: A window that would produce more buckets than the ceiling refuses on the workbench and REST
#   → Scenario: A window too wide for even the coarsest offered step is refused everywhere
# AC6 "offered steps are sub-day: 1 second, 1 minute, 1 hour" — O1 resolved to
#     sub-day by probe: over the Amsterdam fallback night the timezone-argument
#     seconds form drifts off local midnight while toStartOfDay stays at 00:00.
#     Day-scale waits on a reserved period_timezone parameter.
#   → covered by the offered-step constant and its unit test; no runtime behaviour of its own.
# AC7 "each new code has a presentation entry and a remediation entry" → guarded
#    by `codes.unit.test.ts` and the exhaustive `satisfies` in `presentation.ts`.

# The S1-bindable scenarios below are bound by
# `src/server/analytics/lwql/__tests__/lwqlGranularity.unit.test.ts` and
# `.../lwqlGranularityDeclaration.unit.test.ts`. The run-path ones are bound by
# the wiring suites: save-time refusal by
# `src/server/api/routers/__tests__/savedWorkbenchCharts.router.integration.test.ts`,
# the budget refusal on caller-owned doors by
# `src/server/api/routers/__tests__/lwqlGranularityBudget.router.integration.test.ts`
# (workbench) and
# `src/app/api/analytics-sql/__tests__/lwqlGranularityRestApi.integration.test.ts`
# (REST), and run-by-chart-id by
# `src/server/analytics/saved-workbench-charts/__tests__/savedWorkbenchChart.service.unit.test.ts`.

@unit
Scenario: A statement declaring the granularity parameter runs at the step the workbench supplies
  Given SQL declaring period_granularity_seconds as UInt32 alongside both period bounds
  And the workbench supplies a step of 60 seconds
  When the member runs the query
  Then the statement is bound with a granularity of 60 seconds
  And the result is labelled as following the granularity

@unit
Scenario: A granularity declared with no step supplied runs on its own authored bucketing
  Given SQL declaring period_granularity_seconds as UInt32
  And the surface supplies no step
  When the member runs the query
  Then no granularity value is bound
  And the result is still labelled as following the granularity, since the statement declares it

@unit
Scenario: A caller that supplies period_granularity_seconds itself is refused
  Given SQL declaring period_granularity_seconds as UInt32
  When a caller supplies a value for period_granularity_seconds directly
  Then the run is refused as a reserved parameter supplied
  And the refusal names exactly the parameters the caller supplied

@unit
Scenario: The granularity parameter declared as anything but UInt32 is refused
  Given SQL declaring period_granularity_seconds as a String
  When the statement is validated
  Then it is refused as a wrong granularity declaration
  And the refusal names UInt32 as the required declared type

@unit
Scenario: A zero or fractional step is refused as a wrong declaration
  Given SQL declaring period_granularity_seconds as UInt32
  When the surface supplies a step that is zero, negative, fractional, or not an offered step
  Then the run is refused as a wrong granularity declaration
  And the refusal says the step must be one of the offered steps

@integration
Scenario: A saved chart declaring granularity without both period parameters is refused at save
  Given SQL declaring period_granularity_seconds without period_start or period_end
  When the member saves the chart
  Then the save is refused because granularity requires the period parameters
  And the refusal names which period bounds are absent

@unit
Scenario: A granularity declared alongside a mistyped period bound is refused at save
  Given SQL declaring period_granularity_seconds and period_start declared as a String
  When the statement is validated
  Then it is refused because granularity requires well-typed period parameters
  And the refusal distinguishes the mistyped bound from an absent one

@integration
Scenario: A window that would produce more buckets than the ceiling refuses on the workbench and REST
  Given a chart declaring granularity and a requested step of 1 second
  And a period wide enough that the window divided by the step exceeds 10,000 buckets
  When the member runs it on a caller-owned surface
  Then the run is refused as too fine for the period
  And a dashboard running the same chart is coarsened to the finest step that fits
  And the refusal carries the bucket arithmetic in its structured detail

@unit
Scenario: A window too wide for even the coarsest offered step is refused everywhere
  Given a chart declaring granularity over a period spanning a decade
  When even the one-hour step would exceed 10,000 buckets for that period
  Then the run is refused as too fine for the period on coarsening surfaces too
  And the refusal names the requested step and the bucket ceiling

@unit
Scenario: A chart declaring the granularity parameter runs at the step the surface supplies
  Given a saved chart whose SQL declares period_granularity_seconds as UInt32
  And the surface supplies an offered step
  When the chart is run by id
  Then the stored statement is executed at the supplied step
  And the result is labelled as following the granularity

@unit
Scenario: A declared granularity with no step supplied refuses to run naming the parameter
  Given a saved chart whose SQL declares period_granularity_seconds as UInt32
  And the surface supplies no step
  When the chart is run by id
  Then the run is refused for the missing parameter
  And the refusal names period_granularity_seconds

@unit
Scenario: Running a saved chart executes its stored statement with its saved values and the surface's window and step
  Given a saved chart with stored SQL and saved parameter values
  When the surface runs it with its own time window and step
  Then the stored statement is executed with the saved values
  And the surface's window and step are the ones bound

@unit
Scenario: Another project's saved chart is not runnable
  Given a chart saved in one project
  When a run names it from another project
  Then the run is refused as chart not found

@unit
Scenario: Running a saved chart refuses a step finer than the period's bucket budget
  Given a saved chart declaring granularity
  And a step and period whose quotient exceeds the bucket ceiling
  When the chart is run by id
  Then the run is refused as too fine for the period

# The run-by-chart-id procedure's own wiring, as distinct from what the service
# decides. Bound by
# `src/server/api/routers/__tests__/savedWorkbenchCharts.router.integration.test.ts`,
# which runs against a real Postgres and the real RBAC tables so the permission
# claims cannot be answered by a fake that was told what to return.

@integration
Scenario: Running a saved chart carries the same permission and switch as every other chart procedure
  Given a project with the LangWatchQL workbench switched off
  When a member runs a saved chart by id
  Then the run is refused with the not-enabled code
  And with the switch on, the run requires the analytics view permission

@integration
Scenario: A run is refused for a member without the analytics view permission, and nothing is executed
  Given a member whose role carries no analytics view permission
  When they run a saved chart by id
  Then the run is refused as permission denied
  And the query engine is never consulted

@integration
Scenario: A run names the tenant the database holds for the project in the request
  Given a project whose LangWatchQL key is stored in the database
  When a member runs a saved chart by id
  Then the execution request carries that stored key
  And not any key supplied by the caller

@integration
Scenario: Being allowed to read a chart is being allowed to run one
  Given a member whose role grants analytics view but not chart management
  When they run a saved chart by id
  Then the run succeeds
