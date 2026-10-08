Feature: A dashboard widget frame shows what its queries report

  The frame around a widget watches every query the widget runs and reads each result's
  completeness report. It shows no traffic, a setup view or a failure in place of the chart, and
  sends partial data to the card's (i), so the face stays clean. The rules live in
  modules/analytics/browser/src/features/dashboards/WIDGET_STANDARD.md.

  Rule: The frame draws the state the queries report

    @integration
    Scenario: A widget whose query found no traffic says so
      Given a widget on a board
      When its query answers with completeness state "no_traffic"
      Then the card says "No traces in this period" in place of the chart

    @unit
    Scenario: A widget that also reads outside the period draws its own empty face
      Given a widget whose period query found no traffic
      And another of its queries reads outside the period, such as whether a source ever sent data
      When the widget's state is worked out
      Then the frame leaves the card to the widget, which can offer to connect the source

    @integration
    Scenario: A widget whose query needs a field no trace carries shows the setup view
      Given a widget on a board that offers Langy
      When its query answers with completeness state "missing" for the field "total cost"
      Then the card says "Needs total cost"
      And "Ask Langy to help" hands the board the field and its label

    @integration
    Scenario: The setup view has no Langy button where the board offers no Langy
      Given a widget on a read-only board with no Langy hand-off
      When its query answers with completeness state "missing"
      Then the setup view shows no "Ask Langy to help" button

    @integration
    Scenario: A widget whose query fails names itself and offers Retry
      Given a widget named "Cost per trace"
      When its query fails for good before it ever answered
      Then the card says "Couldn't load Cost per trace" with the reason
      And Retry starts the widget over, so its queries run again

    @integration
    Scenario: A failure the frame will retry does not fail the card yet
      Given a widget whose query is refused as busy
      When the frame has not used all its retries
      Then the card still shows the widget's own face

    @integration
    Scenario: A failed refresh keeps the chart on the card
      Given a widget whose query answered once
      When a later run of it fails
      Then the card still shows the widget's own face

  Rule: Partial data keeps a clean face and goes in the (i)

    @integration
    Scenario: A partial widget sends its notes to the card's info tip
      Given a widget card with no description
      When its query answers with completeness state "partial"
      Then the card shows an (i) beside its title

    @unit
    Scenario: The info tip says what is missing and which models have no price
      Given a partial report with total cost on 400 of 1,000 traces and 600 traces with no price
      When the info tip's notes are written
      Then they read "Total cost on 400 of 1,000 traces." and "No price for my-finetune-v2 (600 traces)."

    @unit
    Scenario: The info tip says how much a widget with whole data checked
      Given a complete report over 1,234 traces
      When the info tip is written
      Then it says "Checked 1,234 traces in this period."
      And partial data, no traffic or no report add no such line

  Rule: A widget with several queries shows one state

    @unit
    Scenario: The worst state over the queries with traffic wins
      Given one query reports "partial" and another "missing"
      When the widget's state is worked out
      Then it is "missing"

    @unit
    Scenario: An empty comparison window does not empty the card
      Given one query reports "complete" and another, over last week, "no_traffic"
      When the widget's state is worked out
      Then it is "complete", and it is "no_traffic" only when every query found none
