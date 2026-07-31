# Implementation:
#   platform/app/src/server/event-sourcing/pipelines/billing-reporting/subscribers/billingMeterPoke.subscriber.ts
#   platform/app/src/server/event-sourcing/pipelines/billing-reporting/process-manager/billingMeterSweep.process.ts
#   platform/app/src/server/app-layer/billing/billingReportingCandidates.service.ts
#   platform/app/src/server/event-sourcing/pipelineRegistry.ts (registerBillingReportingPipeline)
#
# The poke is mounted on every pipeline that produces a billable event (trace,
# evaluation, experiment-run, simulation processing). The sweep is mounted
# once, on the billing-reporting pipeline itself — and the composition root has
# to supply its candidate query for that mount to happen at all, so "the sweep
# runs" is a claim about the registry, not only about the process module.

Feature: Billing meter dispatch

  LangWatch reports SaaS organizations' billable usage to the billing system
  by month, so they are invoiced for what they actually used. Two
  independent triggers keep an organization's month total accurate:

  - A per-event poke reacts the moment a billable event lands anywhere in
    the organization's projects, and asks for that month's usage to be
    re-read and reported.
  - An hourly scheduled sweep re-reads and re-reports usage on its own
    clock, regardless of whether any event has poked recently.

  The poke is the fast path. The sweep is the guarantee: it is the only
  thing that recovers a poke whose report failed to dispatch even after
  retrying, and the only thing that catches an organization whose last
  billable event of the month is also its last event ever — nothing pokes
  again after that, so nothing re-reads the total unless the sweep does.

  Usage reporting exists only in the SaaS build.

Rule: A billable event pokes this month's usage report

  @unit
  Scenario: A billable event pokes the usage report for the current month
    Given a billable event occurs partway through the month
    When the poke handles the event
    Then it resolves the event's project to its organization
    And it dispatches a usage report for that organization's current billing month

  @unit
  Scenario: Rapid billable events collapse onto one usage report
    Given a project produces a burst of billable events in quick succession
    When the poke handles each event in the burst
    Then every event in the burst is collapsed onto the same organization-scoped report
    And a burst from a different project is collapsed onto a report of its own
    # the collapse holds for a debounce window, so a project ingesting
    # continuously still dispatches one report per window rather than one per event

  @unit
  Scenario: A continuously busy organization still gets its report on schedule
    Given an organization whose projects never stop producing billable events
    And a poke lands inside every debounce window, without a gap
    When the debounce window for a staged usage report closes
    Then that report runs at the moment it was originally due
    And the next poke opens a fresh window rather than postponing the pending one
    # the failure this replaces: each poke pushed the pending report a further
    # debounce window into the future, so the organizations with the most
    # billable traffic — the largest invoices — were the ones whose report
    # never came due at all

  @unit
  Scenario: The project's organization is looked up once per cache window
    Given a project has produced a billable event before
    When another billable event from the same project is poked
    Then the organization behind it is reused rather than looked up again
    But a project seen for the first time is looked up
    # this lookup sits on the busiest path in the product; re-reading it per
    # event is a database load problem that shows up as latency, not as a
    # failure

  @unit
  Scenario: One kill switch stops the poke everywhere it is mounted
    Given the poke is mounted on all four pipelines that produce billable events
    When an operator needs to stop billing pokes during an incident
    Then a single kill switch stops every mount
    And that switch is the one the operations page offers

  @unit
  Scenario: A dispatch that fails is raised, not swallowed
    Given the usage report dispatch fails for a billable event
    When the poke handles that event
    Then the failure is raised rather than logged and discarded
    And the event's job is retried instead of being marked successful

  @unit
  Scenario: Late events inside the grace window still reach the previous month
    Given a billable event occurs within the grace window at the start of a new month
    When the poke handles the event
    Then it dispatches a usage report for the previous month as well as the current month
    But a billable event occurring after the grace window has closed only dispatches a report for the current month

  @unit
  Scenario: Self-hosted builds never poke the usage meter
    Given the product is running as a self-hosted build, not SaaS
    When the billing meter poke is set up
    Then it is mounted disabled and never stages a job

Rule: A scheduled sweep guarantees the report even when nothing pokes

  @unit
  Scenario: Scheduled sweep re-reports usage without any new events
    Given the sweep's hourly schedule wakes it
    When the sweep runs
    Then it records that tick once
    And it dispatches a fresh usage report for every organization with billable activity this month
    # even when no billable event has occurred since the last report

  @unit
  Scenario: Scheduled sweep still closes the previous month during the grace window
    Given the sweep runs during the grace window at the start of a new month
    When it looks for organizations to report
    Then it dispatches a usage report for the previous month as well as the current month

  @unit
  Scenario: A sweep that cannot dispatch every report is retried
    Given one organization's usage report fails to dispatch during a sweep
    When the sweep finishes that tick
    Then it still dispatches every other organization's report
    And it raises so the whole tick is retried
    But given the sweep cannot even list which organizations to report
    When it runs
    Then it raises so the tick is retried

  @unit
  Scenario: A failure listing one month does not skip the other
    Given the sweep runs during the grace window, so it owes two months
    And listing the organizations for the current month fails
    When the sweep runs
    Then it still lists and dispatches the previous month's reports
    And it raises so the whole tick is retried
    # the grace window is only a few days wide, and it is the only window in
    # which a month that has stopped receiving events gets closed out

  @unit
  Scenario: The organizations to report are every one that could owe usage
    Given the sweep asks which organizations to report for a month
    Then it names every organization the usage report is able to act on
    And it also names every organization already reported for that month
    But it names each of them only once
    # the second source makes the set sticky: an organization must not drop
    # out of the safety net just because the live read happened to land while
    # its subscription row was being rewritten

  @unit
  Scenario: The sweep is armed by the composition root, not merely defined
    Given the application wires up its event-sourcing pipelines
    When the billing-reporting pipeline is registered
    Then the scheduled sweep is mounted with a real candidate query
    # a scheduled process that nothing mounts passes every test it has and
    # protects nothing; this shipped unmounted once already

  # ============================================================================
  # Known Limitations
  # ============================================================================

  # - Org resolution lag: the poke's project -> organization lookup is
  #   cached for several minutes, so a project moved to a different
  #   organization can still poke the previous one for a short time after
  #   the transfer.
  # - Fixed grace window: only the first few days of a new month still
  #   close out the previous one. An event that arrives after the window
  #   has closed is reported against the month it actually occurred in,
  #   not the one it was late for.
  # - Cancelled mid-tail: usage reporting acts only on organizations with a
  #   live paid subscription, so an organization that cancels before its last
  #   month's total has been reported keeps that tail unreported. The sweep
  #   still names it as a candidate; it is the report itself that declines.
