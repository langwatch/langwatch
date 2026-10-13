Feature: A timeseries series names a metric the translator knows, or it is refused
  As the owner of a project's analytics data
  I want a metric name to be one of the enumerated analytics metrics
  So that no caller text can reach the ClickHouse SELECT list

  # The timeseries wire schema takes `series[].metric` as a free string, because
  # the metric registry that enumerated the keys is presentation-coupled and
  # lives with the browser surface. The narrowing therefore has to happen where
  # the meaning is: the ClickHouse metric translator.
  #
  # It did not happen. An unknown metric fell through to a `count() AS <alias>`
  # fallback, and the alias only stripped dots from the metric, so caller text
  # landed raw in the SELECT list of a built (not parameterised) query. Two
  # doors reached it: the tRPC read and `POST /api/analytics/timeseries`, the
  # latter with nothing more than an ordinary project API key. A scalar
  # subquery injected there carries no TenantId predicate and returns in the
  # response — an arbitrary read across every tenant on the instance.
  #
  # The refusal is the enumeration itself: the six category arrays that type
  # each category translator's `metric` parameter, plus the directly mapped
  # fields. The switches carry no `default` branch, so the arrays cannot drift
  # from the SQL they stand for. The alias builder sanitises every part to
  # [a-zA-Z0-9_] as a second fence, independent of the first.

  @unit
  Scenario: A known metric compiles to its ClickHouse expression
    Given a series naming an enumerated analytics metric
    When the timeseries query is built
    Then the query selects that metric's aggregate expression

  @unit
  Scenario: An unknown metric is refused as a validation error naming its series
    Given a series naming a metric the translator has no expression for
    When the timeseries query is built
    Then the request is refused as a validation error
    And the refusal names the metric field of that series

  @unit
  Scenario: Injected SQL in a metric name never reaches the built query
    Given a series whose metric carries a subquery and a comment terminator
    When the timeseries query is built
    Then the request is refused as a validation error
    And no built query contains the injected text

  @unit
  Scenario: Every part of a metric alias is reduced to letters, digits and underscores
    Given an alias built from a metric, a key and a subkey carrying punctuation
    When the alias is built
    Then the alias contains only letters, digits and underscores

  @unit
  Scenario: A series key reaches the query only as a bound parameter
    Given a series whose evaluator key carries a quote and a comment terminator
    When the timeseries query is built
    Then the key appears only in the bound parameters, never in the SQL text
