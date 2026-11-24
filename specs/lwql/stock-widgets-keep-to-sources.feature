Feature: Stock widgets that count production read only views that keep an origin
  Langy's own turns trace into the project under the origin "langy" (ADR-061), next to
  simulations and evaluations. The per-minute rollups (`model_usage_by_minute`,
  `trace_metrics_by_minute`) keep no origin, so a stock widget that reads them counts every
  source. The Release check marked Langy's model as a change to production that way. Each stock
  widget that keeps to its sources reads its traffic, tokens, spend and new models from
  trace_metrics instead, where the widget's sources apply.

  Background:
    Given a project with application traces on one model
    And Langy traces on a model the application never used

  @unit
  Scenario: A widget that keeps to its sources reads no view without an origin
    Given the stock widgets of the catalogue
    When a widget has a query that reads {dashboard_context_sources:Array(String)}
    Then none of its queries reads model_usage_by_minute or trace_metrics_by_minute

  @integration
  Scenario: A model only Langy used is not marked as a change to production
    When the changes query runs under the application list
    Then it lists no change for Langy's model
    And under the langy list it lists Langy's model as new

  @integration
  Scenario: The Release check compares production around a change production made
    When the Release check's traffic query runs under the application list
    Then it compares around production's newest change, not a later model only Langy used

  @integration
  Scenario: Spend per model, traffic and tokens leave out Langy's traces
    When the cost by model, traffic and spend, and token trend queries run under the application list
    Then they count only the application traces and name no Langy model
    And a trace that used two models splits its cost evenly between them
