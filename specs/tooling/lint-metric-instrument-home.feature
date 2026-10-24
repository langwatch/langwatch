Feature: A module's metric instruments live in its metrics service
  As a maintainer
  I want every metric instrument a module creates outside its metrics service reported
  So that each series has one owner to find, name and replace in a test, and the count only falls

  See dev/docs/ARCHITECTURE.md §17 (Alex, 2026-10-20). In modules and enterprise/modules (not
  packages), a metric instrument is created only in a file whose name contains "metrics": the
  module's `<subject>-metrics.service.ts`, injected where the event happens. An instrument is
  created by the shapes `langwatch/metric-instrument-in-a-service` recognises: a factory imported
  from @langwatch/observability (named, renamed or read off a namespace import) or an
  OpenTelemetry meter's `create*` method. That oxlint rule refuses an instrument at module scope
  and holds no list; this policy owns where the instrument is created, and
  tests/baselines/metric-instrument-home.json holds today's count per file.

  Rule: `metric-instrument-home` reports a metric instrument created outside a module's metrics file

    @unit @architecture
    Scenario: An instrument created in a module file not named for metrics is reported
      Given a module process service that imports counter and histogram from @langwatch/observability/metrics
      And creates both inside its class
      When the metric-instrument-home policy reads module source
      Then it reports each call at its line

    @unit @architecture
    Scenario: An instrument reached through a namespace import or a meter is reported
      Given a module repository that calls `metrics.counter` on a namespace import of the factories
      And calls `createHistogram` on an OpenTelemetry meter
      When the metric-instrument-home policy reads module source
      Then it reports both calls

    @unit @architecture
    Scenario: An instrument in the module's metrics service is accepted
      Given a module file named `ingest-metrics.service.ts` that creates a counter and a meter histogram
      When the metric-instrument-home policy reads module source
      Then it reports nothing

    @unit @architecture
    Scenario: A call that is not a metrics factory, a test and a package are left alone
      Given a module service calling a local function named counter
      And a module test file and a file under packages that both create a counter
      When the metric-instrument-home policy reads module source
      Then it reports nothing

    @unit @architecture
    Scenario: Every finding says where the instrument belongs
      Given a module service creating a counter
      When the finding is read
      Then it names the module's metrics service and the shrink-only list it is counted in

    @unit @architecture
    Scenario: No module file gains a metric instrument outside its metrics service
      Given the repository and tests/baselines/metric-instrument-home.json
      When the policy counts instruments per file
      Then no file holds more than its listed count

    @unit @architecture
    Scenario: A moved instrument lowers the list in the same change
      Given the repository and tests/baselines/metric-instrument-home.json
      When the policy counts instruments per file
      Then no file holds fewer than its listed count
