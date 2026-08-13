Feature: Saved governed SQL workbench charts — the persistence model and its write choke point

  As an authorized LangWatch project member
  I want the governed SQL and the Vega-Lite specification I built in the workbench
  to be saved together as one project-scoped record
  So that a metric I authored once keeps its query, its parameter values and its
  chart, and neither can be edited into something the workbench itself would refuse

  Issue: #6582, slice 1 of the delivery stack (persistence model, repository,
  service). Builds on the governed SQL workbench (#6577) and the governed
  analytics SQL API (#6480).

  Scope of this slice — deliberately server-side only. No tRPC router, no REST
  route, no workbench Save/Open UI, no dashboard rendering and no MCP tool: those
  are slices 2 to 5, and each has its own scenarios. What is settled here is the
  record, where it lives, and the single write path everything later must go
  through.

  The design under proof:
  - One record, not two. A saved chart extends `CustomGraph` with a `kind`
    discriminator, following the `SavedView.kind` precedent, so dashboard
    placement, ordering and deletion come from the existing dashboard layer and
    existing builder charts are untouched.
  - The saved definition is versioned JSON holding the three things that travel
    together: the submitted SQL, its named bound parameter values, and the
    Vega-Lite specification that renders the result. Execution and visualization
    stay separate — no visualization syntax inside the SQL.
  - The service is the only write path. Both governors run on the way in: the
    governed SQL validator (#6480) and the Vega-Lite policy (#6577). Neither is
    re-implemented here; both are called.
  - Every read and every write is scoped by project id.

  Background:
    Given a project whose member is authorized for governed analytics SQL

  # ---------------------------------------------------------------------------
  # The saved definition
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A saved definition carries the query, its parameter values and its specification
    Given a definition holding governed SQL, named scalar parameter values and a Vega-Lite specification
    When it is read as a saved workbench chart definition
    Then all three are preserved together
    And the definition declares the version it was written in

  @unit
  Scenario: A chart saved without a hand-authored specification is the same record
    Given a definition holding only governed SQL and its parameter values
    When it is read as a saved workbench chart definition
    Then it is accepted with no specification
    And nothing invents one on its behalf

  @unit
  Scenario: A parameter value that is not a scalar is refused
    Given a definition whose parameter values include an object or an array
    When it is read as a saved workbench chart definition
    Then it is refused
    And the same scalar values the query endpoint accepts are the ones accepted here

  @unit
  Scenario: A definition written in an unknown version is refused rather than guessed at
    Given a stored definition declaring a version this build does not know
    When it is read as a saved workbench chart definition
    Then it is refused
    And nothing is silently reinterpreted as the current version

  @unit
  Scenario: A definition larger than the stored ceilings is refused
    Given a definition whose SQL, parameter count or parameter value exceeds what is stored
    When it is read as a saved workbench chart definition
    Then it is refused for being too big
    And the SQL ceiling is the same one the governed query endpoints enforce, so a
      statement the workbench will run is always one it can save

  # ---------------------------------------------------------------------------
  # The write choke point — both governors run on the way in
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A specification the chart policy refuses never reaches the database
    Given a specification the workbench's Vega-Lite policy refuses
    When the member saves a chart carrying it
    Then the save is refused with error code saved_workbench_chart_specification_refused
    And the refusal carries what the policy objected to, so the member can repair it
    And no record is written

  @unit
  Scenario: SQL the governed validator refuses never reaches the database
    Given SQL the governed analytics validator refuses
    When the member saves a chart carrying it
    Then the save is refused with the governed validator's own refusal code
    And no record is written

  @unit
  Scenario: A query whose declared parameters have no saved values is refused at save
    Given SQL declaring a bound parameter the definition supplies no value for
    When the member saves the chart
    Then the save is refused with error code governed_sql_parameter_missing
    And the missing parameter is named

  @unit
  Scenario: Editing a saved chart runs exactly the governors that creating it ran
    Given a saved chart that passed both governors
    When the member updates it with SQL or a specification either governor refuses
    Then the update is refused for the same reason a create would have been
    And the previously saved definition is left as it was

  @unit
  Scenario: What the author may read decides what their saved SQL may name
    Given a member whose protections withhold a content-gated column
    When they save a chart whose SQL names that column
    Then the save is refused by the governed validator
    And the refusal is the same one the query endpoint would have given them

  # ---------------------------------------------------------------------------
  # Reading a saved chart back
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A saved chart reads back with its SQL, parameters and specification intact
    When the member saves a chart and reads it back
    Then the SQL is the statement they submitted, unmodified
    And the parameter values are the ones they saved
    And the specification is the one they saved

  @integration
  Scenario: A saved chart is listed among the project's workbench charts
    Given the project has saved workbench charts
    When the member lists them
    Then every saved chart is listed
    And the project's existing builder charts are not among them

  @integration
  Scenario: A builder chart is not readable as a workbench chart
    Given the project has an existing builder chart
    When the member reads it as a saved workbench chart
    Then it is not found
    And the builder chart is left untouched

  @integration
  Scenario: A saved workbench chart is not readable as a builder chart
    Given the project has a saved workbench chart and an existing builder chart
    When a chart-builder read path looks the saved chart up by its id
    Then it is not found
    And it is not named among the builder charts that were found
    And the builder chart alongside it is still found

  @integration
  Scenario: A stored definition that no longer matches the schema is named, not returned as data
    Given a saved chart whose stored definition does not match the versioned schema
    When the member reads it
    Then the read is refused with error code saved_workbench_chart_definition_invalid
    And nothing is returned as though it were a usable definition

  # ---------------------------------------------------------------------------
  # Tenancy — the project boundary
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Another project's saved chart is not readable
    Given a chart saved in one project
    When a member of a different project reads it by its id
    Then it is not found
    And the answer is indistinguishable from an id that never existed

  @integration
  Scenario: Another project's saved charts are not listed
    Given two projects each holding saved workbench charts
    When a member lists one project's saved charts
    Then only that project's charts are listed

  @integration
  Scenario: Another project's saved chart cannot be edited or deleted
    Given a chart saved in one project
    When a member of a different project updates or deletes it by its id
    Then the attempt is refused as not found
    And the chart is left exactly as it was

  # ---------------------------------------------------------------------------
  # Slice 2 — the application's own surface: tRPC procedures and Save/Open
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Saved charts stay unreachable while the workbench switch is off
    Given the governed SQL feature switch is off for the project
    When the member lists, opens, saves, edits or deletes a saved chart
    Then every one of them refuses with error code governed_sql_not_enabled
    And nothing in the browser can force the surface on

  @integration
  Scenario: The switch is decided for the project's organization, not for the project alone
    Given the feature switch is granted to the organization that owns the project
    When the member lists their saved charts
    Then the surface answers, because the organization the project belongs to was resolved and offered to the switch
    And a project in an organization without the grant is still refused

  @integration
  Scenario: Reading saved charts requires the analytics permission
    Given a signed-in member whose role lacks the analytics view permission
    When they list or open a saved chart
    Then the request is refused before any chart is read

  @integration
  Scenario: Being allowed to read a chart is not being allowed to change one
    Given a member who may view analytics but not create, update or delete them
    When they list saved charts and then try to save, edit or delete one
    Then the listing succeeds
    And each write is refused for want of its own permission

  @integration
  Scenario: A refusal from the write gate reaches the member with its code intact
    Given SQL or a specification the governors refuse
    When the member saves it through the application
    Then the failure arrives carrying the same code the service raised
    And the member reads the registry copy for that code, not a raw wire message

  @integration
  Scenario: Every procedure answers only for the project in the request
    Given a chart saved in another project
    When the member opens, edits or deletes it by its id
    Then it is not found
    And the answer is indistinguishable from an id that never existed

  @integration
  Scenario: Save stores what is on screen, and saves again into the same chart
    Given a member who has written governed SQL, its parameters and a specification
    When they save it and then save a second time after an edit
    Then the first save creates one chart
    And the second updates that same chart rather than creating another

  @integration
  Scenario: Open restores a saved chart's query, parameters and specification
    Given the project has a saved chart
    When the member opens it from the list of saved charts
    Then the editor holds the saved SQL
    And the parameter editor holds the saved values
    And the specification editor holds the saved specification

  @integration
  Scenario: Save as a new chart leaves the one that was open alone
    Given the member has opened a saved chart and changed what is on screen
    When they choose to save it as a new chart
    Then a second chart is created under the name they give it
    And it becomes the one Save now writes to
    And the chart they opened keeps what was saved in it

  @integration
  Scenario: A saved chart can be renamed or deleted from the list
    Given the project has saved charts
    When the member renames one and deletes another
    Then the renamed chart keeps its query and specification
    And the deleted one is gone from the list

  # ---------------------------------------------------------------------------
  # Slice 4 — the REST surface: saved charts under a project API key
  #
  # The same charts, reached by an integration rather than by a signed-in member,
  # under the governed analytics SQL family at
  # /api/v1/projects/{projectId}/analytics/charts. The credential is a project
  # API key, so the project id in the path is a cross-check and never the scope,
  # exactly as it is for the query and schema endpoints. Every route goes through
  # the same service, so an integration cannot save anything a member could not.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A chart created over the API reads back exactly as it was submitted
    Given an integration holding a project API key
    When it creates a chart and reads it back by its id
    Then the SQL is the statement it submitted, unmodified
    And the parameter values are the ones it submitted
    And the specification is the one it submitted
    And the chart appears in the project's chart listing

  @integration
  Scenario: A specification the chart policy refuses is refused over the API, and nothing is written
    Given a specification the workbench's Vega-Lite policy refuses
    When the integration posts a chart carrying it
    Then the request is refused with error code saved_workbench_chart_specification_refused
    And the refusal names the rule broken and where in the specification it was broken
    And the project's chart listing is unchanged

  @integration
  Scenario: SQL the governed validator refuses earns the same code over the API as the query endpoint
    Given SQL naming a content-gated column the calling key's protections withhold
    When the integration posts a chart carrying it
    Then the request is refused with the governed validator's own refusal code
    And it is the identical code the governed query endpoint gives that key for that SQL
    And the project's chart listing is unchanged

  @integration
  Scenario: A definition larger than the endpoint's ceiling is refused before anything is stored
    Given an integration holding a project API key
    When it posts a chart whose definition is larger than the endpoint accepts
    Then the request is refused with error code validation_error
    And the project's chart listing is unchanged
    And an edit into a definition that large is refused the same way

  @integration
  Scenario: Every chart endpoint stays dark while the workbench switch is off
    Given the governed SQL feature switch is off for the project
    When the integration lists, reads, creates, updates or deletes a chart
    Then every one of them refuses with error code governed_sql_not_enabled

  @integration
  Scenario: The API's switch is decided for the project's organization
    Given the feature switch is granted to the organization that owns the project
    When the integration lists the project's charts
    Then the surface answers, because the organization the project belongs to was resolved and offered to the switch
    And a project in an organization without the grant is still refused

  @integration
  Scenario: A chart is invisible to another project's key
    Given a chart created with one project's key
    When another project's key reads, updates or deletes it by its id
    Then each attempt is refused as not found
    And the chart is absent from that project's listing
    And the chart is left exactly as it was

  @integration
  Scenario: A path naming another project reaches nothing
    Given a key for one project and the id of another project that exists
    When the key is used against the other project's path
    Then the request is refused with error code project_not_found

  @integration
  Scenario: A key that may read charts may not write them
    Given a key whose permissions allow viewing analytics and nothing more
    When it lists and reads charts and then tries to create, update or delete one
    Then the reads succeed
    And each write is refused before the service is reached
    And the project's chart listing is unchanged

  @integration
  Scenario: A stored definition this build cannot read is named, not returned as data
    Given a stored chart whose definition does not match the versioned schema
    When the integration reads it or lists the project's charts
    Then the read is refused with error code saved_workbench_chart_definition_invalid
    And no raw stored payload is returned in its place

  @integration
  Scenario: An update naming neither a name nor a definition is refused rather than quietly doing nothing
    Given a chart the integration has created
    When it sends an update carrying neither field
    Then the request is refused with error code validation_error
    And the chart is left exactly as it was

  @integration
  Scenario: Deleting a chart answers with no content and empties the listing
    Given a chart the integration has created
    When it deletes the chart and lists the project's charts again
    Then the deletion answers with no content
    And the chart is gone from the listing
    And deleting it a second time is refused as not found

  @unit
  Scenario: Every chart endpoint is published in the API document
    Given the generated OpenAPI document
    When the saved chart paths are looked up in it
    Then all five operations are described, each with a summary, a tag and a response schema

# --- AC Coverage Map ---
# Issue #6582, slice 1 ("Schema + repository + service — model decision,
# validation choke point, unit/integration tests").
#
# AC "extend CustomGraph with a discriminator rather than adding a parallel table"
#   → Scenario: A saved chart is listed among the project's workbench charts
#   → Scenario: A builder chart is not readable as a workbench chart
#   → Scenario: A saved workbench chart is not readable as a builder chart
#   (the discriminator's whole observable job is that the two kinds do not see
#   each other, in BOTH directions; the model decision itself is verified in the
#   PR diff and the migration)
# AC "the definition JSON holds { sql, parameters, vegaLiteSpec }, Zod-validated,
#    versioned"
#   → Scenario: A saved definition carries the query, its parameter values and its specification
#   → Scenario: A chart saved without a hand-authored specification is the same record
#   → Scenario: A parameter value that is not a scalar is refused
#   → Scenario: A definition written in an unknown version is refused rather than guessed at
#   → Scenario: A definition larger than the stored ceilings is refused
# AC "service is the validation and governance choke point — the only write path"
#   → Scenario: A specification the chart policy refuses never reaches the database
#   → Scenario: SQL the governed validator refuses never reaches the database
#   → Scenario: A query whose declared parameters have no saved values is refused at save
#   → Scenario: Editing a saved chart runs exactly the governors that creating it ran
# AC "both the SQL and the Vega-Lite spec are re-validated on the way in"
#   → the four choke-point scenarios above
#   → Scenario: What the author may read decides what their saved SQL may name
# AC "a spec the workbench would refuse must not become renderable by being
#    written to the database and read back" — the write half is the choke-point
#    scenarios; the stored-shape half is
#   → Scenario: A stored definition that no longer matches the schema is named, not returned as data
#   (re-validating a stored spec against the *policy* on the way out belongs with
#   the surface that renders it — slice 3's degraded card — because a chart
#   refused on read must still be openable for repair)
# AC "every read and write stays projectId-scoped"
#   → Scenario: Another project's saved chart is not readable
#   → Scenario: Another project's saved charts are not listed
#   → Scenario: Another project's saved chart cannot be edited or deleted
# AC "existing charts must not regress"
#   → Scenario: A builder chart is not readable as a workbench chart
#   (plus the existing dashboard and graph suites, which the migration's default
#   keeps green by leaving every pre-existing row a builder chart)
# AC "repositories findAll/findById, services getAll/getById" → process AC,
#    verified in the PR diff.
#
# Issue #6582, slice 2 ("tRPC + workbench Save/Open UI").
#
# AC "tRPC router — save, list, open, update, delete"
#   → Scenario: Save stores what is on screen, and saves again into the same chart
#   → Scenario: Open restores a saved chart's query, parameters and specification
#   → Scenario: Save as a new chart leaves the one that was open alone
#   → Scenario: A saved chart can be renamed or deleted from the list
#   → Scenario: Every procedure answers only for the project in the request
# AC "the surface stays behind the experimental switch, evaluated server-side"
#   → Scenario: Saved charts stay unreachable while the workbench switch is off
#   → Scenario: The switch is decided for the project's organization, not for the project alone
# AC "reads and writes are permissioned"
#   → Scenario: Reading saved charts requires the analytics permission
#   → Scenario: Being allowed to read a chart is not being allowed to change one
# AC "each failure with a stable code and presentation-registry entry"
#   → Scenario: A refusal from the write gate reaches the member with its code intact
#   → Scenario: A refused save says what to repair, and leaves the work on screen
# AC "saving never re-runs the query" → carried for now by the workbench's own
#   guard, `Scenario: The workbench ships no polling, browser-side persistence,
#   export, or agent surface`, which slice 2 amended rather than deleted. The
#   stronger claim — that *opening* a saved chart issues no request — needs the
#   whole workbench driven end to end, so it lands with the browser test rather
#   than being written here unbound. Two scenarios were drafted for this slice
#   and removed for exactly that reason ("Opening a saved chart runs nothing
#   until the member asks", "A refused save says what to repair, and leaves the
#   work on screen"): a scenario the parity check reports as bound-to-nothing
#   reads as coverage and is worse than one not yet written.
#
# Issue #6582, slice 4 ("REST surface — the same charts under a project API
# key, in the governed analytics SQL family").
#
# AC1 "the five routes exist and round-trip"
#   → Scenario: A chart created over the API reads back exactly as it was submitted
#   → Scenario: Deleting a chart answers with no content and empties the listing
# AC2 "the write gate is not bypassable over REST"
#   → Scenario: A specification the chart policy refuses is refused over the API, and nothing is written
#   (the listing half of that scenario is the load-bearing one: a refusal alone
#   passes against a handler that wrote first and threw afterwards)
#   → Scenario: A definition larger than the endpoint's ceiling is refused before anything is stored
#   (the definition reaches the service as `unknown`, and nothing below the
#   route bounds its size — the versioned schema puts no ceiling on the
#   statement it holds — so the request-shape ceiling is the route's own, and
#   the listing half is again what makes "nothing is written" mean anything)
# AC3 "the governed validator's own codes survive the wire"
#   → Scenario: SQL the governed validator refuses earns the same code over the API as the query endpoint
# AC4 "the feature switch closes every route"
#   → Scenario: Every chart endpoint stays dark while the workbench switch is off
#   → Scenario: The API's switch is decided for the project's organization
# AC5 "tenancy"
#   → Scenario: A chart is invisible to another project's key
#   → Scenario: A path naming another project reaches nothing
# AC6 "permissions are per-verb"
#   → Scenario: A key that may read charts may not write them
#   (asserted as "a view-only key is refused", not as a literal scope string:
#   `analytics:delete` is only ever held through `analytics:manage`, so naming
#   the string would pin an implementation choice rather than the behaviour)
# AC7 "an unreadable stored definition is named, not returned"
#   → Scenario: A stored definition this build cannot read is named, not returned as data
# AC8 "the routes are published"
#   → Scenario: Every chart endpoint is published in the API document
#   (plus `pnpm check:openapi-route-coverage`, which fails on a handler with no
#   `describeRoute` — the scenario is what fails when the *document* loses them)
# AC9 "no regression" → the existing governed SQL REST suite, unedited, which
#   runs the extracted guards through the query and schema endpoints.
# AC10 "every slice-4 scenario is actually bound" → `pnpm check-feature-parity`.
#
# Design decision 1 of the slice-4 plan — PATCH rather than PUT, and a PATCH
# carrying neither field is a refusal rather than a silent no-op:
#   → Scenario: An update naming neither a name nor a definition is refused rather than quietly doing nothing
#
# Deliberately NOT in this feature file, because they are not in these slices:
# dashboard placement and rendering (with #6631's time-window contract),
# per-viewer re-execution and its degraded cards, and the MCP/langy authoring
# tools. Each lands with its own scenarios in slices 3 and 5.
