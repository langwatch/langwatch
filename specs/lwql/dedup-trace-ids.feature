Feature: An Instant Evals pass reads only the traces it holds through a latest-in-order view
  A latest-in-order view keeps each row's latest version in a subquery that ends in LIMIT 1 BY,
  and ClickHouse applies no filter of the caller's below it: a pass that wanted the thread id of
  fifty traces read every trace's attribute map. Each such view keyed by trace has a trace-ids
  twin, cut by a list of trace ids inside the subquery, and the key, sample and page passes read
  it with the traces they already hold. Why: modules/analytics/adrs/006-stock-widget-views-latest-in-order.md,
  amendment 2026-11-24.

  @unit
  Scenario: A latest-in-order view keyed by trace gets a trace-ids twin cut before LIMIT 1 BY
    Given the shipped catalogue
    When its views are provisioned
    Then traces, trace_metrics and simulation_trace_metrics each get a twin named <view>__ids
    And the twin is its view with "TraceId IN ({lwql_trace_ids:Array(String)})" read before ORDER BY and LIMIT 1 BY, and nothing else
    And a view a caller's filter already reaches, such as spans, or one not keyed by trace, such as evaluations, gets none

  @unit
  Scenario: Each trace-ids twin is granted to the restricted identity
    Given the shipped access model
    When it is rendered
    Then the restricted identity may SELECT from each trace-ids twin

  @unit
  Scenario: A pass statement the cut cannot change reads the trace-ids twin
    Given a pass statement with one SELECT over one twin-able view, bare, database-qualified, aliased or read with a star
    And whose result rows are the view's rows, one each, carrying the view's own TraceId
    When the pass composes its read
    Then the view is read through its twin, under the name the statement gave it
    And a subquery in its WHERE still reads the view itself

  @unit
  Scenario: A pass statement the cut could change reads the view as written
    Given a pass statement that groups, aggregates, uses a window, a LIMIT, a LIMIT BY, DISTINCT, a JOIN, an ARRAY JOIN or a UNION
    And the cases that rename or drop TraceId, use a column set or transformer (COLUMNS, REPLACE, APPLY, EXCEPT, a qualified star), name the view beside its alias, shadow the view with a WITH, reference it by a three-part name, read a view with no twin, declare the key step's own parameter, or do not parse
    When the pass composes its read
    Then it reads the view as written

  @unit
  Scenario: A key or sample pass reads its keys over the trace-ids twin, cut by its page's traces
    Given a key or sample pass that projects a key column beyond the row ids
    When it runs over a statement the cut cannot change
    Then it first reads the page's row ids from the statement as written
    And then reads the page's keys under the same condition, order and limit, over the twin cut by those traces
    And a pass of the ids alone, a probe and a count stay one read of the statement as written

  @unit
  Scenario: A page pass reads the trace-ids twin cut by its own traces
    Given a page pass with the trace ids it hydrates
    When it runs over a statement the cut cannot change
    Then it reads the twin cut by those trace ids

  @unit
  Scenario: A pass reads its view as written while the trace-ids twin is not readable
    Given a deployment where the twin is not provisioned yet, or its grant has not landed
    When the twin read is refused as unavailable or as provisioning incomplete, which ClickHouse's unknown table function maps to
    Then the pass reads the same traces' keys, or the same page, from the statement as written and returns its rows
    And a refusal naming another relation, or any other refusal of the twin read, refuses the pass

  @integration
  Scenario: A trace-ids twin returns only the calling tenant's rows
    Given two tenants' traces in each twin's source table
    When the first tenant reads each trace-ids twin for every trace id the table holds
    Then only the first tenant's rows come back

  @unit
  Scenario: A caller cannot read a trace-ids twin directly
    Given a statement that names traces__ids or trace_metrics__ids by name, database-qualified, in a subquery or as a table function
    Then the validator refuses it

  @unit
  Scenario: A two-step page that loses a picked row is read again, then as one read
    Given a statement whose window moves between the two steps of a key or sample pass
    When the keys step returns other row ids than the ids step picked
    Then both steps are read again from the same cursor
    And when they still disagree the page is read as one query of the statement as written

  @integration
  Scenario: A two-step pass returns the rows the single read returns
    Given traces where some carry a newer version, with a new thread id or a time outside the window
    When a sample, a first key page, a later key page, a later span-keyed page and a page pass run over the twin
    Then each returns exactly the rows the single read of the statement as written returns
