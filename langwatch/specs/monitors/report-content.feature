Feature: What a scheduled report actually sends
  As a team subscribing to a scheduled report
  I want the report to carry the data it promises — matching traces, the graph, the dashboard
  So that the message is worth reading on its own, without following a link

  Background:
    Given a report is a schedule-triggered automation
    And a report sends one of three things: a table of matching traces, a single custom graph, or a whole dashboard

  Rule: A report carries its data, not just a link to it

    Scenario: A trace-query report sends the traces that matched
      Given a report whose source is matching traces
      And the author has written a search query for the traces they care about
      When the report fires
      Then it sends the top traces matching that query over the report's window
      And each trace carries its own cost, duration, model, and status
      And following the report's link opens the same traces

    Scenario: A trace-query report without a query sends the window's traces
      Given a report whose source is matching traces
      And the author has written no search query
      When the report fires
      Then it sends the most recent traces in the report's window

    Scenario: A custom-graph report sends the graph
      Given a report whose source is a custom graph
      When the report fires
      Then it sends the graph's series plotted over the report's window
      And it names the graph and its headline value

    Scenario: A dashboard report sends every panel on the dashboard
      Given a report whose source is a dashboard
      When the report fires
      Then it sends one chart per panel on that dashboard

    Scenario: A report whose source has no data still delivers
      Given a report whose graph returns no data points for the window
      When the report fires
      Then it delivers a message saying there was nothing to show
      And it does not deliver an empty message

  Rule: The message layout follows the report's source — the author never picks a layout that cannot render

    Scenario: A dashboard report needs no layout choice
      Given the author is configuring a dashboard report
      Then no message layout is offered to choose from
      And the dashboard's panels map straight to the message

    Scenario Outline: A report is offered only layouts that fit its source
      Given the author is configuring a <source> report
      Then the layouts offered all render <fits>
      And no <excluded> layout is offered

      Examples:
        | source       | fits                | excluded        |
        | custom-graph | a chart             | table-of-traces |
        | trace-query  | the matching traces | chart           |

    Scenario: Changing the report's source moves the author to a layout that fits
      Given the author picked a chart layout for a custom-graph report
      When they change the source to matching traces
      Then the layout changes to one that renders the traces

  Rule: The author can see the report before it is scheduled

    Scenario: The preview renders against report data
      Given the author is editing a report's message
      Then the preview shows example traces or chart data, not an empty message
      And the variables offered are the report's own, not another automation's
