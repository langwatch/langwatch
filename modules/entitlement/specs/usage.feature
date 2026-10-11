Feature: Entitlement's meters, decisions and who learns them
  As entitlement, the module that owns all counting
  I want my own meters, my own decisions recorded as events, and no peer calling me to count
  So that limits are enforced at every door without closing a peer cycle

  See dev/docs/ARCHITECTURE.md §3 (entitlement owns all counting), §9 (peer subscribers, pending
  answers) and §11 (entitlement decides, billing only sends). usage-counting.feature holds the
  counting and warning behaviour ported from main; this file holds the meters, the propagation and
  the wire.

  Background:
    Given an organization with two projects on a plan capped at 1,000 traces a month

  # --- The trace count ---------------------------------------------------------
  # Ruling (Alex, 2026-10-11): a count per project and month, folded from trace's facts. Trace
  # records each trace once when first seen; its upgrade records each project's month up to a cut.
  # Entitlement never asks trace: a peer fold over the two facts, replayable from trace's log.

  @unit @usage
  Scenario: A trace first seen adds one to its project's month
    Given traces of a project first seen this month and one first seen last month
    When the month's trace count is read for the organization
    Then each trace counts once, in the month it was first seen

  @unit @usage
  Scenario: A redelivered first sighting does not count its trace twice
    Given a trace's first sighting was counted
    When the same fact is delivered again
    Then the month's trace count is unchanged

  @unit @usage
  Scenario: The seed sets the month's base, however often it is delivered
    Given trace recorded a project's month as 40 traces before the cut
    When that fact is delivered twice, or re-sent under a new id
    Then the month's count is 40

  @unit @usage
  Scenario: A trace is counted by the seed or by its sighting, never by both
    Given first sightings before and after the cut, some arriving before the seed and some after
    When the seed for the month is folded
    Then sightings before the cut add nothing and sightings from the cut on add one each

  @unit @usage
  Scenario: A later seed's cut wins whatever order the seeds arrive in
    Given two seeds of one month with different cuts
    When the later cut is folded before the earlier one
    Then the month counts from the later cut

  @unit @usage
  Scenario: A replay of trace's facts reaches the live count, in any order
    Given the live lane counted a month from sightings and its seed
    When the same facts are replayed from trace's log, deduplicated by idempotency key
    Then the replayed count equals the live count whatever the order

  @unit @usage
  Scenario: A first sighting from a project in no organization is skipped, loudly
    Given a project that belongs to no organization
    When a first sighting arrives for it
    Then no trace count is written
    And a warning is logged naming the project

  # Round 22 (2026-10-07): count everywhere; the billable-events meter stays SaaS only.
  @unit @usage
  Scenario: The trace count registers on every deployment, the billable-events meter on SaaS only
    When the usage pipeline registers its global projections
    Then the trace count is registered as the peer fold "entitlement.usageTraceCount" on every deployment
    And only a SaaS deployment registers the billable-events meter

  @unit @usage
  Scenario: The month's trace count is read off the organization-keyed count
    Given the trace count's rows are routed by organization
    When the fold reads a project's month back, or the month is counted
    Then each project's newest row is read on the organization's cluster

  @integration @usage @unimplemented
  Scenario: A seeded month's trace count equals trace's own count for that month
    Given ClickHouse holding a month of trace summaries and no trace count
    When trace's upgrade records the month and new traces arrive after the cut
    Then each project's trace count equals its traces first seen in the month

  @unit @usage
  Scenario: The trace count decides a limit as the live trace count did, over the same traces
    Given an organization metered in traces whose projects' traces this month are on the trace count
    When the limit is checked and the month is counted per project
    Then the decision and the per-project counts equal those over a live count of the same traces

  @unit @usage
  Scenario: The trace meter keeps a fixed thirteen month window outside tenant retention
    Given the trace meter is a billing-grade record
    When the ClickHouse schema is migrated and the TTL reconciler runs
    Then the trace meter deletes rows thirteen months after their month began
    And no tenant retention policy or reconciler pass rewrites that window

  # --- The billable-events meter ------------------------------------------------

  @unit @usage
  Scenario: The billable-events meter keeps its lane name
    When the usage pipeline registers its global projections
    Then the billable-events meter is registered as "orgBillableEventsMeter"
    And billing registers no projection of that name

  @unit @usage
  Scenario: A billable event from an orphan project is skipped, loudly
    Given a project that belongs to no organization
    When a billable event arrives for it
    Then no meter row is written
    And a warning is logged naming the project

  @unit @usage
  Scenario: A project's organization is not remembered as missing
    Given a project whose organization could not be found a moment ago
    When the project joins an organization and its next billable event arrives
    Then that event is metered against the organization

  # --- Deciding the limit -------------------------------------------------------

  @unit @usage
  Scenario: Crossing the allowance records the limit as reached
    Given the organization's month's count reaches 1,000
    When entitlement counts the organization's month
    Then a limit_reached event is recorded with the count, the allowance, the plan name and the unit

  @unit @usage
  Scenario: Counting again past the allowance records nothing new
    Given the limit is already recorded as reached this month
    When entitlement counts the organization's month again
    Then no further limit event is recorded

  @unit @usage
  Scenario: An upgrade clears a reached limit
    Given the limit is recorded as reached this month
    And the organization's plan is raised to 10,000 traces a month
    When the refused organization's process manager wakes
    Then a limit_cleared event is recorded

  @unit @usage
  Scenario: A trace-metered organization past its allowance records the limit as reached
    Given an organization on tiered pricing whose month's traces reach its plan's allowance
    When entitlement counts the organization's month
    Then the trace meter is read
    And a limit_reached event is recorded with the trace count and the unit traces

  # The billable-events meter is still read for an uncapped plan: billing reports
  # month_counted's total to Stripe whatever the cap.
  @unit @usage
  Scenario: An unlimited plan is never counted for enforcement
    Given the organization's plan caps nothing
    When entitlement counts the organization's month
    Then the trace meter is not read and no limit event is recorded

  @unit @usage
  Scenario: A count the meter cannot answer decides nothing
    Given the meter's store cannot be read
    When entitlement counts the organization's month
    Then no limit event is recorded
    And a warning is logged naming the organization and its plan

  @unit @usage
  Scenario: The plan chooses the meter
    Given an organization on seat-and-event pricing
    When entitlement counts the organization's month
    Then the billable-events meter is read and not the trace meter

  # --- Who learns it --------------------------------------------------------------
  # The ingest doors ask entitlement's assertWithinUsageLimit on every export (Alex,
  # 2026-10-06); trace folds no limit fact. Billing alerts from entitlement's fact.

  @integration @trace
  Scenario: The collector door refuses exactly as the OTLP door does
    Given an organization whose plan's allowance entitlement refuses
    When a trace arrives at POST /api/collector and at OTLP ingest for one of its projects
    Then both refuse with ERR_PLAN_LIMIT, status 402 and the same reading

  @unit @billing
  Scenario: A reached allowance tells billing to alert
    Given entitlement recorded a limit_reached event for the organization
    When billing handles the event
    Then billing's plan-limit alert is told the plan, the unit, the count and the allowance

  @unit @trace @unimplemented
  Scenario: A redelivered limit event leaves one refusal
    When trace handles the same limit_reached event twice
    Then the organization has one refusal for the month

  @unit @scenario @unimplemented
  Scenario: Scenario events are refused from scenario's own record of the limit
    Given scenario has handled a limit_reached event for the organization this month
    When a scenario event is posted for one of its projects
    Then the event is refused with ERR_PLAN_LIMIT and status 402
    And no usage or entitlement Api is asked

  @unit @billing
  Scenario: Billing reports to Stripe from the month's counted total
    Given a month_counted event for the organization with 5,000 billable events
    And billing's checkpoint for the month stands at 4,000
    When billing's subscriber handles the event
    Then Stripe is sent a quantity of 1,000 for the month

  @unit @billing
  Scenario: A lower corrected total is applied as an explicit adjustment
    Given billing's checkpoint for the month stands at 5,000
    When billing's subscriber handles a month_counted event with 4,500 billable events
    Then billing applies an adjustment of minus 500 for the month and the checkpoint becomes 4,500
    And the lower total is not dropped as a stale reading

  @unit @billing
  Scenario: A redelivered month_counted event applies no second adjustment
    Given billing has applied an adjustment for a month_counted event
    When billing's subscriber handles the same event again
    Then no further adjustment is applied

  @unit @billing
  Scenario: Billing's monthly report sends a lower corrected total as a negative meter event
    Given billing's checkpoint for the month stands at 5,000
    When the month's report reads a corrected total of 4,500
    Then Stripe is sent a meter event of minus 500, which its sum meter subtracts
    And the checkpoint becomes 4,500

  @unit @billing
  Scenario: A redelivered downward correction is applied once
    Given billing has sent a correction from 5,000 down to 4,500
    When the month's report runs again, or replays it after a crash
    Then nothing more is sent, or the replay reuses the correction's Stripe identifier

  @unit @trace @unimplemented
  Scenario: Every limit is soft, so ingest is accepted while the limit event is still in flight
    Given entitlement has recorded limit_reached but trace has not yet handled it
    When a trace arrives at OTLP ingest for one of the organization's projects
    Then the ingest is accepted, because enforcement is eventual and fails open
    And the overshoot is the documented enforcement lag, not a defect

  @unit @trace @unimplemented
  Scenario: An upgrade reinstates ingest promptly through limit_cleared
    Given trace refuses ingest for an organization after limit_reached
    When the organization upgrades its plan and entitlement records limit_cleared
    Then trace accepts ingest again as soon as it handles limit_cleared

  # --- Stored names ---------------------------------------------------------------
  # Event types become lw.entitlement.* (Alex, 2026-10-06, night); stored lw.usage.* still reads.

  @unit @usage
  Scenario: A stored usage event reads as its entitlement event type
    Given a month_counted event stored as lw.usage.month_counted before the rename
    When the event is read back or delivered after the rename
    Then it is handled as lw.entitlement.month_counted with the same data
    And billing's subscriber and the refused-organizations process handle it once

  # --- The wire -----------------------------------------------------------------

  @integration @usage @unimplemented
  Scenario: The usage reading keeps its wire path and shape
    Given a member of the organization
    When they query limits.getUsage for the organization
    Then the answer matches the usage stats schema main served
    And the count comes from entitlement's own meter

  @integration @usage @unimplemented
  Scenario: A non-member cannot read the organization's usage
    Given a user who is not a member of the organization
    When they query limits.getUsage for the organization
    Then the call is refused as forbidden

  @integration @usage @unimplemented
  Scenario: Only an organization manager may ask for the approaching-limit warning
    Given a member without organization:manage
    When they call limits.checkAndSendUsageLimitNotification
    Then the call is refused as forbidden

  @unit @usage
  Scenario: Asking for a warning records it rather than sending it
    Given the organization at 92% of its allowance with no warning recorded this month
    When an organization manager calls limits.checkAndSendUsageLimitNotification
    Then a lw.entitlement.usage_threshold_crossed event is recorded for the 90% threshold
    And the answer says the warning was recorded, without a notification id

  @unit @usage
  Scenario: Asking twice in a month records the threshold once
    Given a warning is already recorded for the 90% threshold this month
    When an organization manager calls limits.checkAndSendUsageLimitNotification at 92%
    Then the 90% threshold stays recorded once for the month
    And the answer still says the warning was recorded

  @integration @usage @unimplemented
  Scenario: The spend roll-up keeps its wire path
    Given a member who can reach one of the organization's two projects
    When they query costs.getAggregatedCostsForOrganization for this month
    Then only that project's spend is returned

  # --- The graph ------------------------------------------------------------------

  @unit @usage @unimplemented
  Scenario: No module names the usage Api as a dependency
    Given the installed process modules
    When their static dependencies are read
    Then none names UsageApi
    And entitlement's metering asks only its own billing and project peers

  @unit @usage
  Scenario: Trace is no longer asked to count usage
    Given the installed process modules
    When entitlement's dependencies are read
    Then it names no TraceApi
