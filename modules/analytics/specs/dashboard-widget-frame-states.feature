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

  Rule: A reader who may not see a widget's data is told so

    A query that reads a column or calls a function the reader's role may not see is refused as
    a whole by the server. The refusal names what the reader lacks, and the frame says so in
    place of the chart. It is not a failure: no red, no Retry, no reason from the query.

    @unit
    Scenario: A refusal that is only about access names what the reader lacks
      Given a statement that reads a column the caller's permissions withhold
      When the validator refuses it
      Then every violation carries the gates the caller lacks, such as "cost:view"
      And the refusal is classified as one of access, with those gates

    @unit
    Scenario: A refusal about the query's shape is not one of access
      Given a statement refused for a withheld column and for something else, such as a SETTINGS clause
      When the refusal is classified
      Then it is not one of access, so a broken query still reads as a failure

    @unit
    Scenario: A function the caller lacks the permission for names that permission
      Given a statement that calls an app function gated on content the caller may not see
      When the validator refuses it
      Then the violation carries the gates the caller lacks
      And a function refused because Instant Evals is off carries none

    @integration
    Scenario: A member without cost access is refused a cost query as a matter of access
      Given a member who holds every catalogue permission but "cost:view"
      When they run a statement that sums TotalCost over analytics.lwql.query
      Then the answer is the handled error "lwql_not_permitted", not an internal error
      And its violations classify as an access refusal naming "cost:view"
      And the same member's statement that reads no cost is not refused by the policy

    @unit
    Scenario: A widget whose query is refused for access shows no access, before any other state
      Given a widget with one query refused for access and another that failed or found a missing field
      When the widget's state is worked out
      Then it is "no_access" with the gates the reader lacks
      And a query refused for another reason still fails the widget

    @unit
    Scenario: The no access state says what is withheld and who to ask
      Given the reader lacks "cost:view" in the project "Checkout Agent"
      When the state's words are written
      Then they read "Cost figures are hidden for your role" and "Ask an admin of Checkout Agent if you need to see them."
      And any other gate reads "This data is hidden for your role"

    @integration
    Scenario: A widget the reader may not see says so in place of the chart
      Given a widget named "Cost per trace" on a board
      When its query is refused because the reader lacks "cost:view"
      Then the card says "Cost figures are hidden for your role" and who to ask
      And it shows no Retry, no failure title and none of the refusal's own words

    @integration
    Scenario: A widget with no access offers nothing that reads its data
      Given a stored board's widget whose query is refused for access, on a board that offers Langy
      When the reader looks at the card's controls
      Then there is no Ask Langy, no Edit with Langy, no Set an alert and no Send as a report
      And Edit code is offered only to a reader who may edit widgets
      And the widget keeps its title, and Copy widget id, Duplicate and Delete stay

    @integration
    Scenario: A From LangWatch widget with no access offers no Ask Langy
      Given a From LangWatch board's widget whose query is refused for access
      When the reader looks at the card
      Then the card keeps its title and shows the no access state
      And it offers no Ask Langy
