Feature: The Release check finds an application's releases where the application names its version
  A real application names the version it runs as the OpenTelemetry resource attribute
  `service.version`, or as `version` (or `app_version`) in the trace metadata, as the integration
  docs show. The Release check used to know only prompt versions and models it had not seen
  before, so an application that shipped v14 and v14.1 on one model and no managed prompt had no
  change to compare around, and a model only Langy ran became the newest change once Langy's
  traces were counted.

  The trace module folds the version into trace_analytics as `AppVersion`: `service.version`,
  else `metadata.version`, else `metadata.app_version`. `trace_metrics` exposes it, so the stock
  widgets read a typed column and no map (analytics ADR-004), and a release is the first time a
  version appears in the traces of the widget's sources.

  Background:
    Given a project whose application traces name a version
    And Langy traces on a model the application never used

  @unit
  Scenario: The trace fold reads the version where an application puts it
    Given a span whose resource carries service.version "v14.1"
    Then the trace's AppVersion is "v14.1"
    And a trace that sends only metadata.version "v14" has AppVersion "v14"
    And a trace that sends only metadata.app_version "2.3.0" has AppVersion "2.3.0"
    And service.version wins over metadata.version when a trace sends both
    And a trace that names no version has an empty AppVersion

  @unit
  Scenario: The resource's service.version reaches the trace's attributes
    Given a span whose resource carries service.version "v14.1"
    Then the trace summary's attributes hold service.version "v14.1"

  @integration
  Scenario: Each new version in the period is marked as a release
    Given application traces on version "v13.2" from before the period
    And application traces on "v14" and then "v14.1" inside the period
    When the changes query runs under the application list
    Then it lists "Release v14" and "Release v14.1", each at the first trace that carried it
    And it lists no release for "v13.2", which was running before the period

  @integration
  Scenario: The Release check compares production around the newest release
    Given application traces on "v14" and then "v14.1" inside the period
    And a Langy trace on a new model after "v14.1"
    When the Release check's traffic query runs under the application list
    Then it compares the 7 days after "v14.1" first appeared with the same days a week before
    And Langy's model is not the change it compares around

  @integration
  Scenario: A version only Langy's traces carry is not a release of the application
    Given Langy traces that name a version the application never sent
    When the changes query runs under the application list
    Then it lists no release for that version
    And under the langy list it lists that version as a release

  @integration
  Scenario: A project whose traces name no version keeps its prompt and model changes
    Given application traces that name no version
    When the changes query runs under the application list
    Then it lists no release
    And it still lists a model that production began to use in the period
