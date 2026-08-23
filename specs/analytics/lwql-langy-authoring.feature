Feature: Langy authors saved workbench charts and places them on dashboards

  As Langy, an agent driving the LangWatch CLI on a member's behalf
  I want to save a LangWatchQL chart and put it on a dashboard
  So that a metric I was asked to build keeps updating where the team already
  looks, without a human ever opening the workbench

  Issue: #6712, epic #6582 slice 5. Builds on the saved-chart persistence and
  REST surface (#6582 slices 1 and 4, specs/analytics/lwql-saved-charts.feature)
  and on running a saved chart by id (#6631, specs/analytics/lwql-workbench.feature).

  Scope of this slice. A saved workbench chart has always been a record with no
  address: `create` wrote a row, and nothing after it could ever set that row's
  `dashboardId` or grid position. This slice closes exactly that gap — placing
  and unplacing an already-saved chart — and gives Langy a CLI it can drive to
  reach the capability. Three surfaces carry the work, and this file states
  scenarios for each:
  - the service and repository, which gain `placeChart`/`unplaceChart` alongside
    the existing `createChart`/`updateChart`/`deleteChart`/`runChart`;
  - two REST routes beside the five that already exist, under the same
    LangWatchQL analytics SQL family and the same feature switch and
    permissions;
  - the CLI verbs, the skill and the Langy routing row that let an agent reach
    both without a human touching the workbench. Those scenarios are stated
    here because they are implied by the same acceptance criteria, but they are
    bound by commits later than this slice's service and REST work — a `chart`
    CLI family, a `lwql-charts` recipe and an `AGENTS.md` row do not exist yet
    at the point this file is written, and the parity check reports them
    unbound until those commits land.

  The design under proof:
  - Placing a chart is a service operation, not a side effect of creating one.
    `createChart` still writes an unplaced row; `placeChart` is the only way a
    saved chart gains a `dashboardId` and a grid position, and `unplaceChart` is
    the only way it loses one.
  - Placement reuses the tenancy check dashboard creation already has —
    `dashboardBelongsToProject` — rather than re-deriving it. A dashboard id
    from another project is refused the identical way whether the chart being
    placed is a builder graph created pre-placed or a saved workbench chart
    placed after the fact.
  - Grid-row allocation is one shared decision, not two writers guessing. The
    same helper that already counts both chart kinds when a builder graph is
    created without an explicit row now backs `placeChart` too, so a placed
    workbench chart cannot land on a row a builder chart already occupies, and
    neither can the reverse.
  - The REST placement routes validate nothing about what a chart or a
    dashboard id means — only the request's envelope. What "placed" is allowed
    to mean stays the service's decision, exactly as it already is for a
    chart's definition.
  - A Langy-authored chart is a saved chart like any other. Nothing on the CLI
    or REST path writes a row a human saving through the workbench could not
    have produced, and nothing it writes is exempt from a governor a
    human-authored chart would have to pass.

  Background:
    Given a project whose member is authorized for LangWatchQL analytics SQL
    And the project has a saved workbench chart that has never been placed

  # ---------------------------------------------------------------------------
  # Placing and unplacing a saved chart — the service layer
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Placing a chart requires a dashboard id and accepts an optional grid position
    Given a saved chart and the id of a dashboard in the same project
    When the chart is placed on the dashboard with no grid position supplied
    Then the placement is accepted
    And a grid position is allocated for it

  @unit
  Scenario: Unplacing a chart clears every placement field, not just the dashboard id
    Given a saved chart already placed on a dashboard with a grid position
    When the chart is unplaced
    Then its dashboard id, grid column, grid row, column span and row span are
      all cleared
    And nothing about its saved definition changes

  @integration
  Scenario: A placed chart round-trips with the dashboard id and grid position it was given
    Given a saved chart and a dashboard in the same project
    When the member places the chart with an explicit grid column, grid row,
      column span and row span
    Then reading the chart back shows the same dashboard id and the same grid
      position
    And the chart appears among that dashboard's charts

  @integration
  Scenario: Placing a chart onto another project's dashboard is refused, and nothing is written
    Given a saved chart in one project and a dashboard that belongs to a
      different project
    When the member tries to place the chart on that dashboard
    Then the placement is refused with error code
      saved_workbench_chart_dashboard_not_found
    And the chart is left exactly as unplaced as it was

  @integration
  Scenario: Placing a chart onto a dashboard already holding builder charts does not overlap them
    Given a dashboard already holding builder charts across several grid rows
    When the member places a saved workbench chart on it with no grid row
      supplied
    Then the chart is allocated a row none of the existing builder charts
      occupy
    And the dashboard's existing builder charts keep the rows they already had

  @integration
  Scenario: Placing a saved workbench chart does not let a builder chart land on top of it
    Given a dashboard already holding a placed saved workbench chart
    When the member creates a new builder chart on the same dashboard with no
      grid row supplied
    Then the new builder chart is allocated a row the saved workbench chart
      does not occupy

  @unit
  Scenario: Placing a chart that does not exist in this project is refused
    Given a chart id that does not name a saved chart in this project
    When the member tries to place it on a dashboard
    Then the placement is refused as not found
    And no dashboard's chart list gains an entry for it

  # ---------------------------------------------------------------------------
  # Placement and REST — the same rules, reached with a project API key
  # ---------------------------------------------------------------------------

  @integration
  Scenario: An integration places a saved chart on a dashboard over the API
    Given an integration holding a project API key and a dashboard in its
      project
    When it puts a placement on a saved chart naming that dashboard
    Then the response carries the chart with its new dashboard id and grid
      position
    And reading the chart back by its id shows the same placement

  @integration
  Scenario: An integration unplaces a saved chart over the API
    Given an integration holding a project API key and a chart already placed
      on a dashboard
    When it deletes the chart's placement
    Then the response has no content
    And reading the chart back shows no dashboard id and no grid position

  @integration
  Scenario: Placement onto a foreign dashboard is refused over the API the same way it is inside the application
    Given an integration holding a project API key and the id of a dashboard
      that belongs to a different project
    When it puts a placement on a saved chart naming that dashboard
    Then the request is refused with error code
      saved_workbench_chart_dashboard_not_found
    And the chart's placement is unchanged

  @integration
  Scenario: Placement routes stay dark while the workbench switch is off
    Given the LangWatchQL feature switch is off for the project
    When the integration puts or deletes a chart's placement
    Then each is refused with error code lwql_not_enabled
    And the chart's placement is unchanged

  @integration
  Scenario: A key that may read charts may not place or unplace them
    Given a key whose permissions allow viewing analytics and nothing more
    When it tries to put or delete a chart's placement
    Then each attempt is refused before the service is reached
    And the chart's placement is unchanged

  @integration
  Scenario: Placing an unknown chart id is refused as not found, indistinguishable from a foreign one
    Given an integration holding a project API key
    When it puts a placement naming a chart id absent from this project
    Then the request is refused as not found
    And the answer does not reveal whether the id belongs to another project or
      to no project at all

  @unit
  Scenario: The placement endpoints are published in the API document
    Given the generated OpenAPI document
    When the placement routes are looked up in it
    Then both operations are described, each with a summary, a tag and a
      response schema

  # ---------------------------------------------------------------------------
  # Deleting a placed chart
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Deleting a placed chart leaves no dangling reference on its dashboard
    Given a saved chart placed on a dashboard that also holds builder charts
    When the member deletes the placed chart
    Then the dashboard's chart list no longer includes it
    And the dashboard's remaining charts are unaffected

  # ---------------------------------------------------------------------------
  # Langy's CLI — author, then place (bound in later commits of this slice)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Langy creates a chart with the CLI and reads it back with the same query, parameters and specification
    Given Langy holding CLI credentials for a project
    When it creates a chart from a SQL file, named parameters and a
      specification file, then gets that chart by the id it was given
    Then the SQL, the parameter values and the specification it reads back are
      the ones it submitted

  @integration
  Scenario: A chart Langy creates is indistinguishable from one a member saves by hand
    Given a chart created through the CLI and a chart saved through the
      application by a member
    When the two are compared
    Then they agree on kind, on the shape of their stored definition and on
      project scoping
    And they differ only in id, name and timestamps

  @integration
  Scenario: SQL naming a column Langy's credentials cannot read is refused identically everywhere
    Given SQL naming a column that Langy's protections withhold
    When the chart is saved through the CLI, through REST directly and through
      the application's own save path
    Then every path refuses with the same LangWatchQL validator error code

  @integration
  Scenario: A specification the chart policy refuses cannot be written through the CLI
    Given a specification the workbench's Vega-Lite policy refuses
    When Langy tries to create a chart carrying it
    Then the CLI reports error code saved_workbench_chart_specification_refused
    And no chart is created

  @integration
  Scenario: Langy places a saved chart on a dashboard with the CLI
    Given Langy holding CLI credentials and the id of a dashboard in the
      project
    When it places a saved chart on that dashboard
    Then the chart's dashboard id and grid position are set
    And the chart is listed among that dashboard's charts

  @unit
  Scenario: Every new CLI verb is machine-readable, not just human-formatted
    Given a chart created, placed, listed, updated, unplaced or deleted through
      the CLI
    When the result is requested as JSON
    Then the data returned carries no human-only formatting
    And it can be parsed by an agent without inspecting the human table output

  @unit
  Scenario: Every CLI verb this slice adds refuses while the workbench switch is off, and writes nothing
    Given the LangWatchQL feature switch is off for the project
    When Langy invokes create, update, delete, run, place or unplace through
      the CLI
    Then every one of them refuses with error code lwql_not_enabled
    And no row is created or mutated by any of them

  @unit
  Scenario: The chart family is discoverable by name, and its skill teaches Langy to check the schema first
    Given the CLI's own command listing and the compiled skill tree
    When the chart command group and the LWQL charts skill are looked up
    Then the chart group appears in the command listing
    And the skill instructs discovering the analytics schema before writing SQL
    And the compiled skill committed in the repository matches a fresh render
      from its source

# --- AC Coverage Map ---
# Issue #6712, epic #6582 slice 5 ("Langy authors saved workbench charts and
# places them on dashboards").
#
# AC1 "Langy can author a chart end to end via the CLI"
#   → Scenario: Langy creates a chart with the CLI and reads it back with the
#     same query, parameters and specification
#
# AC2 "a Langy-authored chart is indistinguishable from a human-saved one"
#   → Scenario: A chart Langy creates is indistinguishable from one a member
#     saves by hand
#
# AC3 "no privileged bypass — invalid SQL is refused identically on every path"
#   → Scenario: SQL naming a column Langy's credentials cannot read is refused
#     identically everywhere
#
# AC4 "no privileged bypass — a refused Vega-Lite spec cannot be written"
#   → Scenario: A specification the chart policy refuses cannot be written
#     through the CLI
#   (the "no row is written" half is carried, for the surfaces this slice's
#   first three commits actually deliver, by: Scenario: Placing a chart onto
#   another project's dashboard is refused, and nothing is written; Scenario:
#   A specification the chart policy refuses is refused over the API, and
#   nothing is written — the latter already lives in
#   specs/analytics/lwql-saved-charts.feature and is not re-stated here)
#
# AC5 "tenant scoping holds on every new verb — get/update/delete/run/place/
#    unplace against another project's chart id all answer not-found"
#   → the `get`/`update`/`delete` half is already bound in
#     specs/analytics/lwql-saved-charts.feature and not re-stated here; `run`
#     is already bound in specs/analytics/lwql-workbench.feature. The two verbs
#     genuinely new to this slice are placement:
#   → Scenario: Placing a chart onto another project's dashboard is refused,
#     and nothing is written
#   → Scenario: Placing an unknown chart id is refused as not found,
#     indistinguishable from a foreign one
#   → Scenario: Placement onto a foreign dashboard is refused over the API the
#     same way it is inside the application
#
# AC6 "a chart can be placed on a dashboard"
#   → Scenario: Placing a chart requires a dashboard id and accepts an
#     optional grid position
#   → Scenario: A placed chart round-trips with the dashboard id and grid
#     position it was given
#   → Scenario: An integration places a saved chart on a dashboard over the API
#   → Scenario: Langy places a saved chart on a dashboard with the CLI
#
# AC7 "placement onto a foreign dashboard is refused"
#   → Scenario: Placing a chart onto another project's dashboard is refused,
#     and nothing is written
#   → Scenario: Placement onto a foreign dashboard is refused over the API the
#     same way it is inside the application
#
# AC8 "placement does not collide with builder charts"
#   → Scenario: Placing a chart onto a dashboard already holding builder
#     charts does not overlap them
#   → Scenario: Placing a saved workbench chart does not let a builder chart
#     land on top of it
#
# AC9 "flag-off refusal — every new CLI verb refuses with lwql_not_enabled; no
#    row is written or mutated"
#   → the CLI-verb half is stated in Scenario: Every CLI verb this slice adds
#     refuses while the workbench switch is off, and writes nothing, and is
#     bound once commit 5 (the CLI family) lands
#   → the REST-route half, which this slice's commits 1-3 do bind, is
#     Scenario: Placement routes stay dark while the workbench switch is off
#
# AC10 "the chart family is discoverable by Langy"
#   → Scenario: The chart family is discoverable by name, and its skill
#     teaches Langy to check the schema first
#   → Scenario: Every new CLI verb is machine-readable, not just
#     human-formatted (discoverability without a usable output shape is not
#     yet discoverability for an agent)
#
# AC11 "deleting a placed chart leaves no dangling dashboard reference"
#   → Scenario: Deleting a placed chart leaves no dangling reference on its
#     dashboard
#
# AC12 "every new error code has customer-facing copy"
#   → the process guarantee itself is `pnpm typecheck` against the exhaustive
#   `codes.ts`/`presentation.ts` registries, verified in the PR diff for
#   `saved_workbench_chart_dashboard_not_found`; the scenarios that exercise
#   the code and would surface a missing presentation entry as a broken
#   refusal message are:
#   → Scenario: Placing a chart onto another project's dashboard is refused,
#     and nothing is written
#   → Scenario: Placement onto a foreign dashboard is refused over the API the
#     same way it is inside the application
#
# AC13 "--json / agent output is machine-readable on every new verb"
#   → Scenario: Every new CLI verb is machine-readable, not just
#     human-formatted
#
# Additionally bound here, beyond the numbered ACs, because the REST placement
# routes are a published surface like the five they sit beside:
#   → Scenario: The placement endpoints are published in the API document
#   → Scenario: Placing a chart that does not exist in this project is refused
#   → Scenario: An integration unplaces a saved chart over the API
#   → Scenario: Unplacing a chart clears every placement field, not just the
#     dashboard id
#   → Scenario: A key that may read charts may not place or unplace them
#
# Deliberately NOT in this feature file: dashboard *rendering* of a placed
# workbench chart (widget selection, granularity-aware execution, the
# coarsened-from notice) — that shipped under #6631/S2 and is bound in
# specs/analytics/lwql-workbench.feature and the widget-level unit suites
# alongside it. Running a saved chart by id, and its tenancy and governance
# scenarios, are likewise already bound there and are not re-stated here.
