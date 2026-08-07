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

# --- AC Coverage Map ---
# Issue #6582, slice 1 ("Schema + repository + service — model decision,
# validation choke point, unit/integration tests").
#
# AC "extend CustomGraph with a discriminator rather than adding a parallel table"
#   → Scenario: A saved chart is listed among the project's workbench charts
#   → Scenario: A builder chart is not readable as a workbench chart
#   (the discriminator's whole observable job is that the two kinds do not see
#   each other; the model decision itself is verified in the PR diff and the
#   migration)
# AC "the definition JSON holds { sql, parameters, vegaLiteSpec }, Zod-validated,
#    versioned"
#   → Scenario: A saved definition carries the query, its parameter values and its specification
#   → Scenario: A chart saved without a hand-authored specification is the same record
#   → Scenario: A parameter value that is not a scalar is refused
#   → Scenario: A definition written in an unknown version is refused rather than guessed at
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
# Deliberately NOT in this feature file, because they are not in this slice:
# tRPC and REST CRUD, the workbench Save/Open UI, dashboard placement and
# rendering (with #6631's time-window contract), per-viewer re-execution and its
# degraded cards, and the MCP/langy authoring tools. Each lands with its own
# scenarios in slices 2 to 5.
