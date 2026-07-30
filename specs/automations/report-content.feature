Feature: What a scheduled report actually sends
  As a team subscribing to a scheduled report
  I want the report to carry the data it promises — matching traces, the graph, the dashboard
  So that the message is worth reading on its own, without following a link

  Background:
    Given a report is a schedule-triggered automation
    And a report sends one of three things: a table of matching traces, a single custom graph, or a whole dashboard

  Rule: A report carries its data, not just a link to it

    @unit
    Scenario: A trace-query report sends the traces that matched
      Given a report whose source is matching traces
      And the author has written a search query for the traces they care about
      When the report fires
      Then it sends the top traces matching that query over the report's window
      And following the report's link opens the same traces

    # The dispatch asserts the trace ids and inputs reach the payload; which
    # per-trace columns the Slack template renders is unasserted.
    @unit @unimplemented
    Scenario: Each trace in the report carries its own numbers
      Given a trace-query report that matched several traces
      When the report fires
      Then each trace carries its own cost, duration, model, and status

    @unit
    Scenario: A trace-query report without a query sends the window's traces
      Given a report whose source is matching traces
      And the author has written no search query
      When the report fires
      Then it sends the most recent traces in the report's window

    @unit
    Scenario: A custom-graph report sends the graph
      Given a report whose source is a custom graph
      When the report fires
      Then it sends the graph's series plotted over the report's window
      And it loads charts rather than traces

    @unit
    Scenario: A dashboard report sends every panel on the dashboard
      Given a report whose source is a dashboard
      When the report fires
      Then it sends one chart per panel on that dashboard

    @unit
    Scenario: A dashboard wider than the query concurrency cap still sends every panel
      Given a dashboard with more panels than the concurrent-query cap allows
      When the report fires
      Then the queries are bounded to the cap
      And every panel still comes back, in order

    @unit
    Scenario: A report whose source has no data still delivers
      Given a report whose graph returns no data points for the window
      When the report fires
      Then it delivers a message saying there was nothing to show
      And the empty chart is marked empty rather than drawn as a flat line

    @unit
    Scenario: A monthly report covers the month, not the trailing week
      Given a report scheduled monthly
      When it fires
      Then its window spans the whole month

    @unit
    Scenario: A report whose automation is inactive or gone sends nothing
      Given the trigger behind a due report is inactive or deleted
      When the dispatch runs
      Then nothing is sent

    @unit
    Scenario: A delivered report records that it ran
      Given a report that reached its destination
      When the dispatch finishes
      Then the fire is recorded so the automations page can show it ran

    @unit
    Scenario: Failing to record the fire does not fail a report already delivered
      Given a report that reached its destination
      And recording the fire fails
      Then the dispatch still succeeds

    @unit
    Scenario: A report that reached nobody records no fire
      Given a report with no Slack destination, or whose recipients are all suppressed
      When the dispatch runs
      Then no fire is recorded

  Rule: The message layout follows the report's source — the author never picks a layout that cannot render

    @unit
    Scenario: A dashboard report needs no layout choice
      Given the author is configuring a dashboard report
      Then no message layout is offered to choose from
      And the dashboard's panels map straight to the message

    @unit
    Scenario Outline: A report is offered only layouts that fit its source
      Given the author is configuring a <source> report
      Then the layouts offered all render <fits>
      And no <excluded> layout is offered

      Examples:
        | source       | fits                | excluded        |
        | custom-graph | a chart             | table-of-traces |
        | trace-query  | the matching traces | chart           |

    @unit
    Scenario: A report is offered the same layouts whichever cadence it runs on
      Given the author is configuring a report
      When they change its cadence
      Then the layouts on offer do not change

    # `SET_SOURCE` is proven to clear the filters and graph id that no longer
    # apply, but nothing asserts that the chosen TEMPLATE is moved with it.
    @unit @unimplemented
    Scenario: Changing the report's source moves the author to a layout that fits
      Given the author picked a chart layout for a custom-graph report
      When they change the source to matching traces
      Then the layout changes to one that renders the traces

  Rule: The author can see the report before it is scheduled

    @integration @unimplemented
    Scenario: The preview renders against report data
      Given the author is editing a report's message
      Then the preview shows example traces or chart data, not an empty message
      And the variables offered are the report's own, not another automation's
