# See dev/docs/best_practices/ops-dashboard.md for the layout conventions this
# spec enforces, and dev/docs/adr/090-shared-ops-snapshot-single-writer.md for
# where the data comes from (the parked drill-down this page finally surfaces).

Feature: Ops dashboard information density
  As an operator scanning the ops dashboard during an incident
  I want the page to spend its space on what is wrong
  So that a six-figure number never sits on screen with nothing to explain it

  Context: the landing page spent its first viewport on eleven stat tiles laid
  out in a ten-column grid — so the eleventh wrapped alone onto a second row,
  costing a full row of whitespace — then two full cards that between them said
  "No errors" and "No active anomalies", then a pipeline tree in which nine of
  eighteen rows rendered no counts at all (idle pipelines persist for 24h from
  the known-pipelines registry), then two hundred near-identical group rows
  whose ksuid identifiers consumed most of the width while every other column
  read the same. Meanwhile the Parked tile read 129,091 and nothing anywhere on
  the page said which tenants, or that parked means "at its in-flight cap"
  rather than "broken". The page was long, and none of the length was the
  problem it was meant to show.

  Background:
    Given an operator is viewing the ops dashboard

  # ── The stat strip ────────────────────────────────────────────────────

  @unimplemented
  Scenario: The stat strip occupies a single row
    Given the dashboard renders its full set of headline statistics
    When the strip is laid out at desktop width
    Then every statistic sits on one row
    And no statistic wraps onto a row of its own

  @unit
  Scenario: Redis statistics read as one subject
    Given memory, engine CPU, and client-connection figures are available
    When the stat strip renders
    Then they are presented together as a single Redis statistic
    And each figure keeps its own label

  @unimplemented
  Scenario: A zero counter is shown, not hidden
    Given the dead-letter queue count is zero
    When the stat strip renders
    Then the dead-letter queue statistic is still present
    And it is not styled as a warning

  @unit
  Scenario: Statistic labels are spelled out
    When the stat strip renders
    Then no label abbreviates a word that could be spelled out

  # ── Health line ───────────────────────────────────────────────────────

  @unimplemented
  Scenario: An all-clear health state collapses to one line
    Given there are no error clusters
    And there are no active tenant anomalies
    When the dashboard renders
    Then a single line reports that both are clear
    And no empty card is rendered for either

  @unimplemented
  Scenario: A health problem expands in place
    Given error clusters are present
    When the dashboard renders
    Then the errors expand into their own panel
    And the anomalies stay collapsed on the health line

  # ── Parked explains itself ────────────────────────────────────────────

  @unimplemented
  Scenario: A non-zero parked count offers its explanation
    Given tenants are parked over their in-flight cap
    When the dashboard renders
    Then the parked statistic states that parking is a capacity limit, not a failure
    And it links to the tenants responsible

  @unimplemented
  Scenario: The parked panel names the tenants and their depth
    Given two tenants are parked over cap
    When the operator opens the parked panel
    Then each tenant is listed with its parked group count and how long the oldest has waited
    And the tenants are ordered by parked depth

  @unimplemented
  Scenario: The parked panel is absent when nothing is parked
    Given no tenant is over its in-flight cap
    When the dashboard renders
    Then no parked panel is shown

  # ── Pipeline tree ─────────────────────────────────────────────────────

  @unimplemented
  Scenario: Idle pipelines are folded away by default
    Given eighteen pipelines are known and nine of them have no pending, active, or blocked work
    When the pipeline tree renders
    Then only the nine pipelines with work are listed
    And a control offers to reveal the nine idle pipelines, stating how many there are

  @unimplemented
  Scenario: Revealing idle pipelines keeps them distinguishable
    Given idle pipelines have been revealed
    When the pipeline tree renders
    Then the idle pipelines are visually de-emphasized against the working ones

  @unimplemented
  Scenario: A pipeline that becomes busy leaves the idle fold on its own
    Given an idle pipeline is folded away
    When work arrives for that pipeline
    Then it appears among the working pipelines without the operator reopening the fold

  # ── Groups ────────────────────────────────────────────────────────────

  @unit
  Scenario: A fan-out collapses into one row per cluster
    Given two hundred groups share a pipeline and a trace and differ only by a trailing index
    When the groups table renders
    Then they are presented as a single cluster row carrying the member count
    And the row reports the aggregate pending count and the oldest wait across members

  @unimplemented
  Scenario: A cluster expands to its members
    Given a collapsed cluster row
    When the operator expands it
    Then the individual groups are listed with their own identifiers and actions

  @unit
  Scenario: Groups that share no prefix are not clustered
    Given groups from unrelated pipelines
    When the groups table renders
    Then each is listed on its own row

  @unit
  Scenario: A long identifier stays readable and copyable
    Given a group identifier too long for its column
    When the row renders
    Then the identifier is elided in the middle so both ends stay visible
    And the full identifier can be copied

  # ── Chart ─────────────────────────────────────────────────────────────

  @unit
  Scenario: Both axes share gridlines
    Given the chart plots rates on one axis and counts on the other
    When it renders
    Then both axes divide their range into the same number of intervals
    And every gridline is shared by both

  @unimplemented
  Scenario: The legend says which axis each series belongs to
    When the chart legend renders
    Then rate series and count series are distinguishable by axis

  @unit
  Scenario: An axis label is never clipped
    Given a count axis whose values run into the hundreds of thousands
    When the chart renders
    Then the axis reserves enough width for its longest formatted label

  @unimplemented
  Scenario: A count series stays visible against a much larger sibling
    Given parked groups outnumber pending groups by three orders of magnitude
    When the chart renders
    Then the smaller series remains distinguishable from the axis

  # ── The page as a whole ───────────────────────────────────────────────

  @unimplemented
  Scenario: A healthy platform fits without scrolling
    Given no errors, no anomalies, nothing blocked, and nothing parked
    When the dashboard renders at desktop height
    Then the statistics, chart, and pipeline tree are all reachable without scrolling

  @unimplemented
  Scenario: A problem is reachable without hunting
    Given tenants are parked over cap and error clusters are present
    When the dashboard renders
    Then the parked panel and the error panel both appear above the groups table
