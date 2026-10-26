Feature: The metric-instrument-in-a-service lint rule
  A metric instrument belongs to an injected `<subject>-metrics.service.ts`
  class, never to module scope, where every importer shares one hidden global
  that no test can replace. The same service names the series
  `langwatch_<module>_<what>_<unit>`. Series published before the prefix rule
  are named in the rule's legacy set, because dashboards and alerts read them.

  What the rule refuses, in a module's production code: an instrument created
  at module scope, whether through the observability factories (named,
  renamed or namespace import) or an OpenTelemetry meter's `create*` method,
  and a series name without the `langwatch_` prefix. Where the instrument is
  created (a file whose name contains "metrics") is the `metric-instrument-home`
  policy's, specs/tooling/lint-metric-instrument-home.feature, which holds
  today's offenders on a shrink list. Neither governs `packages/`.

  Background:
    Given a workspace whose agent module has a process half

  @unit
  Scenario: An instrument created at module scope is reported
    Given a production file that imports counter and histogram from @langwatch/observability/metrics
    And calls them at the top level of the file
    When the metric-instrument-in-a-service rule runs over it
    Then it reports instrumentAtModuleScope on each call

  @unit
  Scenario: The report tells the author where the instrument belongs
    Given a module-scope instrument
    When the metric-instrument-in-a-service rule runs over it
    Then the message asks for an injected metrics service

  @unit
  Scenario: An instrument reached through a namespace or a meter is reported
    Given a production file that calls `metrics.counter` on a namespace import of the factories
    And calls `createHistogram` on an OpenTelemetry meter, both at the top level
    When the metric-instrument-in-a-service rule runs over it
    Then it reports instrumentAtModuleScope on each call

  @unit
  Scenario: An instrument inside a service class is accepted
    Given instruments created in a class field, a constructor and an arrow function
    When the metric-instrument-in-a-service rule runs over it
    Then it reports nothing

  @unit
  Scenario: A series name without the langwatch_ prefix is reported
    Given an instrument named by a literal or a module constant that does not start with langwatch_
    When the metric-instrument-in-a-service rule runs over it
    Then it reports seriesNeedsPrefix naming the series

  @unit
  Scenario: A series dashboards already read keeps its name
    Given an instrument whose name is in the legacy set
    When the metric-instrument-in-a-service rule runs over it
    Then it reports nothing

  @unit
  Scenario: A call that is not the metrics factory is left alone
    Given a local function named counter, a test file and a file outside any module
    When the metric-instrument-in-a-service rule runs over them
    Then it reports nothing
