Feature: Scheduled report content and links

  A scheduled report (ADR-044) renders the same graphs the author sees on the
  dashboard, over its own schedule window, and links back to where that data
  lives. Two independent defects from #6716 / the Aug 12 bug bash broke both
  halves of that promise for dashboard reports:

    - The dashboard report's deep link dropped `dashboardId` and sent every
      reader to the generic, dashboard-less analytics page.
    - Summary, pie and donut panels rendered blank, because the report path
      queried the graph's raw stored JSON while the live dashboard UI
      (`CustomGraph.tsx`) compensates before querying — forcing "full"
      resolution for summary charts and injecting a default pipeline for
      grouped pie/donut charts. A dashboard made up of exactly those panel
      types arrived as a completely empty email.

  See dev/docs/adr/044-scheduled-reports-automation-kind.md (ADR-044) and
  platform/app/src/features/analytics/logic/graphQueryCompensation.ts, the
  module shared between the dashboard UI and the report renderer so both
  query a panel the same way.

  Background:
    Given a project with a scheduled report configured

  Rule: A report renders every panel the same way the dashboard does

    @unit
    Scenario: A dashboard report with data delivers per-panel content
      Given a dashboard with a summary panel and a grouped pie panel
      And both panels have real data for the report's window
      When the report renders its charts
      Then the summary panel carries its data point
      And the pie panel carries its segments
      And neither panel is marked empty

  Rule: A report's view link always resolves to the exact data it summarised

    @unit
    Scenario: The report email links to its own dashboard
      Given a report whose source is a specific dashboard
      When the report is dispatched
      Then the delivered message links to that dashboard, not the generic analytics page

  Rule: "Nothing to show" is reserved for a genuinely empty period

    @unit
    Scenario: 'Nothing to show' appears only when the period is genuinely empty
      Given a graph with no series configured
      When the report renders its charts
      Then that panel is marked empty
      And a panel with real data is never marked empty by the same check
