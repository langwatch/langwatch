Feature: LangWatchQL Vega-Lite charts — the shared rendering and governance engine

  As a LangWatch dashboard showing a saved LangWatchQL chart
  I want its Vega-Lite specification validated, rendered, and kept isolated
  from network and file access, themed, accessible, and correctly updated
  as its data or spec changes
  So that a member's saved chart draws safely and correctly without
  weakening tenant isolation, content gating, or the application's
  security policy

  Issue: #6577, originally written for the Custom query workbench page (the
  editor, schema browser, native result table, and Table/Chart mode toggle).
  That page was removed — saved LangWatchQL charts are now authored and
  placed via the dashboard-widgets drawer instead, and a saved chart is
  edited through the same drawer. What remains here is the shared engine the
  page's chart mode was one caller of, and still is a caller of: the
  Vega-Lite validation policy, chart rendering/lifecycle/theming/
  accessibility, chart runtime containment (no network, no file access, no
  embed actions), and the reserved time-window and granularity contract a
  saved chart's SQL may declare into. All of it is exercised today through
  `LangWatchQLDashboardWidget` (a chart placed on a dashboard) and the
  `savedWorkbenchCharts.getById`/`run` procedures it calls.
  The backend owns SQL parsing, validation, tenant isolation, content gating,
  resource limits, result truncation, and analytical diagnostics. The
  frontend half that remains owns Vega-Lite policy, named-dataset injection,
  theming, accessibility, and chart runtime containment.

  Background:
    Given a project whose LangWatchQL analytics SQL API is available to the signed-in member

  # ---------------------------------------------------------------------------
  # What this surface deliberately does not do
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The chart engine ships no polling, browser-side persistence, export, or agent surface
    # Scoped to the shared LangWatchQL chart engine's OWN source (the
    # `analytics-query` surface), not to the dashboards that embed it: a
    # dashboard may schedule its own periodic refresh
    # (specs/analytics/dashboard-widget-resilience.feature), and that is a
    # separate surface this promise does not speak to. The bound test scans the
    # analytics-query engine only, exactly this boundary.
    Given the shared LangWatchQL chart engine's own source
    When it is inspected for schedules, refresh intervals, browser storage,
      sharing links, export, source display, Langy, MCP, or external connectors
    Then none is present in the engine itself
    And the specification the member is editing is never written anywhere by the
      chart surface itself

  @unit
  Scenario: The frontend does not implement a second SQL validator
    Given a draft whose SQL the backend would reject
    When the member runs the query
    Then the exact statement is submitted unmodified
    And the backend's rejection is what the member sees

  # ---------------------------------------------------------------------------
  # Vega dependency pinning and lazy loading
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The Vega dependency set is pinned and compatible
    Given the application's dependency manifest
    When the Vega packages are inspected
    Then react-vega, vega, vega-lite, and vega-embed are direct, exact-pinned,
      mutually compatible versions recorded in the PR

  @integration
  Scenario: Vega loads lazily from the dashboard widget only
    Given the built application's bundles
    When the entry and unrelated route chunks are inspected
    Then no Vega runtime code is present in them
    And the Vega runtime loads only when the dashboard widget's chart is first drawn

  @unit
  Scenario: The lazy Vega wrapper defers its own module, on the dashboard widget
    Given the lazy wrapper for the dashboard widget chart
    When the wrapper's own static import graph is walked
    Then the graph reaches neither Vega nor the module it defers
    And the wrapper's source still names its deferred module in a dynamic import

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
    Given the chart served on a page under a Content Security Policy without unsafe-eval
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
    And today's only caller (the dashboard widget) still supplies just the query result dataset

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

  @unit
  Scenario: A chart saved without a specification draws from a starter over its result columns
    Given a chart saved as a query alone, with no specification
    When its result arrives
    Then a starter specification is derived from the result's columns
    And it names only columns the result actually has

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
  Scenario: A result past the row ceiling is refused clearly, naming the limit it crossed
    Given a result with more rows than the chart's row ceiling
    When the chart is asked to render it
    Then it refuses as a complexity refusal naming the ceiling and the count that crossed it
    And nothing is sampled to make it fit, so the runtime is never reached

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

  # ---------------------------------------------------------------------------
  # Reachability — the experimental switch and provisioning
  #
  # One flag, checked server-side, darkens every LangWatchQL surface at once:
  # the session router a dashboard widget calls and the API-key REST endpoints
  # alike. A deployment with no LangWatchQL identity to run as is a different
  # refusal, since an administrator can flip a switch but cannot provision.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Every chart surface stays dark until the experimental feature switch is on
    Given the LangWatchQL feature switch is off for the project
    When a caller asks whether LangWatchQL is available, or runs a statement through the session router or the REST API
    Then availability answers off, naming the switch as the gate that closed
    And every other call refuses with error code lwql_not_enabled and executes nothing

  @integration
  Scenario: An organization-scoped rule can switch the chart surfaces on
    Given a stored rule enabling the switch for one organization only
    When a project in that organization and a project outside it each ask
    Then the surfaces are on for the first project and off for the second

  @unit
  Scenario: The switch is decided for the project's organization, not for the project alone
    Given a project that resolves to an organization
    When the switch is consulted
    Then it is asked about the project and its organization, never about a member
    And a project that cannot be read is presented as belonging to no organization rather than a guessed one

  @integration
  Scenario: The chart surfaces are unreachable while LangWatchQL is not provisioned
    Given the switch is on but the deployment has no LangWatchQL identity to run as
    When a caller asks whether LangWatchQL is available
    Then availability answers off, naming provisioning rather than the switch

  # ---------------------------------------------------------------------------
  # The request lifecycle every caller shares
  #
  # A dashboard widget's query editor and any future caller drive one request
  # machine: a draft, the snapshot that was submitted, and the outcome credited
  # to that snapshot. The rules below are about whether a REQUEST is issued and
  # which submission an answer is credited to, not about any one page's UI.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A run submits the draft exactly and the answer reads as current
    Given a draft statement and parameters
    When the caller runs it and the request succeeds
    Then exactly that draft is submitted, unmodified
    And the result is credited to it and reads as current

  @unit
  Scenario: Editing the statement or its parameters marks the result stale
    Given a current result
    When the statement or its parameters are edited
    Then the visible result is marked stale and a fresh run is offered

  @unit
  Scenario: A chosen step travels beside the query rather than among its parameters
    Given a statement declaring the granularity parameter
    When the caller chooses a step
    Then the request carries the step in its own field, not among the parameters

  @unit
  Scenario: Changing the step marks the result stale, since it answers a different question
    Given a current result
    When the caller changes the granularity step
    Then the visible result is marked stale

  @unit
  Scenario: Clearing the chosen step sends no step at all, not an empty one
    Given a chosen step
    When the caller clears it
    Then the next request carries no step field

  @unit
  Scenario: A stale result stays labelled as belonging to the previous submission
    Given a result and a second submission that is abandoned before it answers
    When the caller reads the state
    Then the visible result is still the first submission's and is labelled stale

  @unit
  Scenario: A later failure replaces the visible result, credited to the request that failed
    Given a successful result and a later submission that fails
    When the failure arrives
    Then it replaces the visible result and is credited to the request that failed

  @unit
  Scenario: Reload reruns the submitted snapshot exactly
    Given a submitted snapshot the draft has moved away from
    When the caller reloads
    Then the submitted statement and parameters are sent, not the draft

  @unit
  Scenario: Duplicate submissions are prevented while a request is in flight
    Given a request in flight
    When the caller tries to run or reload again
    Then no second request is issued until the first settles

  @unit
  Scenario: An aborted request never updates the visible result
    Given a request in flight
    When the caller is disposed or the request is cancelled
    Then the request is aborted and an answer arriving afterwards changes nothing

  @unit
  Scenario: Cancelling an in-flight run keeps the previous result
    Given a previous result and a run in flight
    When the caller cancels the run
    Then the request is abandoned and the previous result stays on screen

  # ---------------------------------------------------------------------------
  # The time window — reserved period parameters (#6631)
  #
  # A statement opts into the page's period by declaring `{dashboard_context_period_start:DateTime}`
  # and `{dashboard_context_period_end:DateTime}`. The `dashboard_context_` prefix is reserved:
  # supplied by the dashboard, read-only; author-declared params are separate. The surface owns
  # those two names: it supplies their values and refuses a caller that tries to. A statement that
  # declares neither is allowed and is labelled as not following the period, because the
  # failure this contract exists to prevent is two charts on one dashboard
  # silently showing different periods.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A statement declaring the reserved period parameters is given the surface's window
    Given SQL declaring dashboard_context_period_start and dashboard_context_period_end as ClickHouse date-times
    And the surface supplies the window the member is looking at
    When the member runs the query
    Then the values the database is bound with are that window
    And the member supplied neither of them

  @unit
  Scenario: A statement declaring only one reserved period parameter is given that one
    Given SQL declaring dashboard_context_period_start and no dashboard_context_period_end
    When the member runs the query with the surface's window
    Then dashboard_context_period_start is bound to the window's start
    And no dashboard_context_period_end value is sent

  @unit
  Scenario: A caller that supplies a reserved period parameter itself is refused
    Given SQL declaring the reserved period parameters
    When the request carries a value for dashboard_context_period_start of its own
    Then it is refused with error code lwql_reserved_parameter_supplied
    And nothing reaches the database

  @unit
  Scenario: The refusal names the reserved parameter the caller actually supplied
    Given a request refused for supplying a reserved parameter of its own
    When the refusal is inspected
    Then its meta names the parameter that was supplied
    And it does not name a reserved parameter the request never sent

  @unit
  Scenario: A reserved period parameter declared as anything but a date-time is refused
    Given SQL declaring dashboard_context_period_start as a string
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

# --- AC Coverage Map ---
# Issue #6577 ACs → scenarios (grouped as in the issue body). Written for the
# original Custom query workbench page; that page (editor, schema browser,
# native table, Table/Chart mode toggle, Run/Reload request-state UI) was
# removed, and the "Workbench" and "Table" AC groups below along with it —
# their ACs described that page's UI, and the page no longer exists to
# discharge them. The remaining groups (Vega dependencies/loading,
# governance, rendering/UX, time window, granularity) still resolve to real
# surviving scenarios, since the chart engine they describe is still reached
# through the dashboard widget.
#
# Base and scope:
# AC "based on current #6486 head with exact base SHA recorded" → process AC,
#    recorded in the PR body (base branch issue6480/lwql-analytics-sql-api-read-only,
#    base SHA recorded at PR-open time).
# AC "old LWQL parser, IR, branches, API types not used" → process AC, verified
#    in the PR diff (no LWQL import exists to reference); the behavioral shadow is
#   → Scenario: The frontend does not implement a second SQL validator
# AC "SQL grammar, parser, validator, tenant policy, row policies, catalog,
#    resource ceilings unchanged" → process AC, verified by the PR diff touching
#    no LangWatchQL backend module; the frontend half is
#   → Scenario: The frontend does not implement a second SQL validator
# AC "existing Recharts charts are not migrated" → process AC, verified by the
#    PR diff leaving Recharts components untouched.
# AC "polling, schedules, persistence, sharing, export, Langy, MCP,
#    coding-agent tools, external connectors not added to the chart engine"
#   → Scenario: The chart engine ships no polling, browser-side persistence, export, or agent surface
#     (the persistence half of this AC was superseded by #6582 slice 2, which
#     added saving deliberately; the scenario now guards the rest. "schedules"
#     here means the chart engine's own source: a dashboard embedding it may
#     still schedule its own refresh — see
#     specs/analytics/dashboard-widget-resilience.feature — which is a separate
#     surface this AC does not constrain.)
#
# Vega dependencies and loading:
# AC "compatible pinned versions recorded in the PR"
#   → Scenario: The Vega dependency set is pinned and compatible (plus the PR-body record)
# AC "official React wrapper behind a small LangWatch-owned boundary" → process AC,
#    verified in the PR diff; its behavior is exercised by every chart scenario here.
# AC "Vega lazy-loaded only behind its own boundary, absent from unrelated bundles"
#   → Scenario: Vega loads lazily from the dashboard widget only
#   → Scenario: The lazy Vega wrapper defers its own module, on the dashboard widget
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
# AC "a chart over too much data refuses clearly, never samples" — the
#    Table-mode fallback half of this AC no longer applies (no Table mode);
#    the refuse-rather-than-sample half is covered by the complexity-limit
#    and adversarial-corpus scenarios above.
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
# AC "browser tests cover request-to-chart"
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
# AC3 "`{dashboard_context_period_start:String}` is refused at validate time, so it is refused at
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
#     changes them; a member override survives a re-run" — this was
#     workbench-page UI (pre-fill from the page's own period control, and a
#     one-off override that survives a manual re-run); the page and its
#     Run/Reload state are gone. The underlying claim that a placed chart's
#     window IS the surface's window, not the caller's, still holds and is
#     covered by "The window the surface sends is the window the database
#     reads" above.
# AC8 "each new code has a presentation entry and a remediation entry" → guarded
#    by `features/errors/logic/__tests__/codes.unit.test.ts` and by the
#    exhaustive `satisfies` clause in `presentation.ts`, which is a typecheck
#    failure rather than a behaviour this file could describe.
#
# The surface-side half of the contract that is not an AC of its own:
#   → Scenario: A statement declaring only one reserved period parameter is given that one
#   → Scenario: A period-aware statement run with no window names what is unset

# --- Granularity contract (#6713 slice 3, S1): the surface-owned bucket size ---
#
# A statement may declare `{dashboard_context_granularity_seconds:UInt32}` and use it as
# the multiplier of a fixed-unit interval -- `INTERVAL
# {dashboard_context_granularity_seconds:UInt32} SECOND` -- because ClickHouse compiles an
# interval unit to a function name, so only the multiplier can be a bound value.
#
# AC1 "a chart declaring the parameter runs at the step the surface supplies"
#   → Scenario: A statement declaring the granularity parameter runs at the step the surface supplies
#   → Scenario: The resolver reports an unfilled declared granularity rather than inventing a step
# AC2 "a caller-supplied value for a reserved name is refused" (granularity half)
#   → Scenario: A caller that supplies dashboard_context_granularity_seconds itself is refused
# AC3 "the declaration must be UInt32"
#   → Scenario: The granularity parameter declared as anything but UInt32 is refused
#   → Scenario: A zero or fractional step is refused as a wrong declaration
# AC4 "declaring granularity requires declaring both period bounds, checked at save"
#   → Scenario: A saved chart declaring granularity without both period parameters is refused at save
#   → Scenario: A granularity declared alongside a mistyped period bound is refused at save
# AC5 "a window finer than the bucket ceiling is refused on caller-owned surfaces"
#   → Scenario: A window that would produce more buckets than the ceiling refuses on caller-owned surfaces
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
# (tRPC) and
# `src/app/api/analytics-sql/__tests__/lwqlGranularityRestApi.integration.test.ts`
# (REST), and run-by-chart-id by
# `src/server/analytics/saved-workbench-charts/__tests__/savedWorkbenchChart.service.unit.test.ts`.

@unit
Scenario: A statement declaring the granularity parameter runs at the step the surface supplies
  Given SQL declaring dashboard_context_granularity_seconds as UInt32 alongside both period bounds
  And the surface supplies a step of 60 seconds
  When the member runs the query
  Then the statement is bound with a granularity of 60 seconds
  And the result is labelled as following the granularity

@unit
Scenario: The resolver reports an unfilled declared granularity rather than inventing a step
  Given SQL declaring dashboard_context_granularity_seconds as UInt32
  And no step supplied
  When the declaration is resolved on its own, apart from the run path that would refuse it
  Then the resolution still says the statement follows the granularity
  And it carries no granularity value, since inventing one would change what a member's chart shows without them asking

@unit
Scenario: A caller that supplies dashboard_context_granularity_seconds itself is refused
  Given SQL declaring dashboard_context_granularity_seconds as UInt32
  When a caller supplies a value for dashboard_context_granularity_seconds directly
  Then the run is refused as a reserved parameter supplied
  And the refusal names exactly the parameters the caller supplied

@unit
Scenario: The granularity parameter declared as anything but UInt32 is refused
  Given SQL declaring dashboard_context_granularity_seconds as a String
  When the statement is validated
  Then it is refused as a wrong granularity declaration
  And the refusal names UInt32 as the required declared type

@unit
Scenario: A zero or fractional step is refused as a wrong declaration
  Given SQL declaring dashboard_context_granularity_seconds as UInt32
  When the surface supplies a step that is zero, negative, fractional, or not an offered step
  Then the run is refused as a wrong granularity declaration
  And the refusal says the step must be one of the offered steps

@integration
Scenario: A saved chart declaring granularity without both period parameters is refused at save
  Given SQL declaring dashboard_context_granularity_seconds without dashboard_context_period_start or dashboard_context_period_end
  When the member saves the chart
  Then the save is refused because granularity requires the period parameters
  And the refusal names which period bounds are absent

@unit
Scenario: A granularity declared alongside a mistyped period bound is refused at save
  Given SQL declaring dashboard_context_granularity_seconds and dashboard_context_period_start declared as a String
  When the statement is validated
  Then it is refused because granularity requires well-typed period parameters
  And the refusal distinguishes the mistyped bound from an absent one

@integration
Scenario: A window that would produce more buckets than the ceiling refuses on caller-owned surfaces
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
  Given a saved chart whose SQL declares dashboard_context_granularity_seconds as UInt32
  And the surface supplies an offered step
  When the chart is run by id
  Then the stored statement is executed at the supplied step
  And the result is labelled as following the granularity

@unit
Scenario: A declared granularity with no step supplied refuses to run naming the parameter
  Given a saved chart whose SQL declares dashboard_context_granularity_seconds as UInt32
  And the surface supplies no step
  When the chart is run by id
  Then the run is refused for the missing parameter
  And the refusal names dashboard_context_granularity_seconds

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
