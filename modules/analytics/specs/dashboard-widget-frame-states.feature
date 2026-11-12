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
    Scenario: A widget whose query fails says so and offers Retry
      Given a widget named "Cost per trace"
      When its query fails for good before it ever answered
      Then the card says "Couldn't load" with the reason, and its title names the widget
      And Retry starts the widget over, so its queries run again

    @integration
    Scenario: A built-in widget that fails on a limit says the limit is LangWatch's
      Given a From LangWatch widget named "Cost per trace" on a read-only board
      When its query fails with "query_memory_exceeded" or "query_timeout"
      Then the card says "Couldn't load"
      And it says "This widget hit a LangWatch limit in the selected period. This is not a problem with your data."
      And it offers Retry and no edit action

    @integration
    Scenario: An editable widget that fails on memory says its query used too much
      Given a stored widget on a board the reader can edit, with Langy
      When its query fails with "query_memory_exceeded"
      Then the card says "The query used more memory than a widget may use."
      And it offers "Edit with Langy", "Edit code" and Retry

    @integration
    Scenario: An editable widget that fails on time says its query ran too long
      Given a stored widget on a board the reader can edit
      When its query fails with "query_timeout"
      Then the card says "The query ran past the time a widget may take."

    @integration
    Scenario: A reader who cannot edit is told to ask someone who can
      Given a stored widget on a board the reader cannot edit
      When its query fails with "query_memory_exceeded"
      Then the card says "Ask someone who can edit this dashboard to change the query."
      And it offers no edit action

    @integration
    Scenario: A failed limit card carries short words beside the full words
      Given a stored widget that fails on a limit
      When the card shows the failure
      Then it holds "Hit the memory limit." or "Hit the time limit." hidden from screen readers
      And a reader who cannot edit also has "Ask someone to edit it." in the same way
      And the full message and note stay in the title and are what a screen reader reads

    @e2e @unimplemented
    Scenario: The smallest cards show only the short words
      Given a stored widget that fails on a limit, on a card of three rows
      When the card is as narrow as 240px and as short as 157px
      Then the card shows the short words and not the full ones

    @e2e @unimplemented
    Scenario: Cards of other sizes show the whole message within their room
      Given a stored widget that fails on a limit, with a message of five lines
      When the card is at least 341px wide and 158px to 177px high
      Then the card shows four lines of the message when there is no note
      And a card at least 278px high shows the message in full

    @integration
    Scenario: Edit actions wait while the board is being written
      Given a stored widget that failed on a limit, on a board the reader can edit
      When the board is being written
      Then "Edit with Langy" and "Edit code" are disabled and Retry is not

    @integration
    Scenario: A failure that is not a limit keeps its existing message
      Given a built-in widget and a stored widget
      When a query fails with another code, such as "lwql_unknown_identifier"
      Then each card shows that error's own message and no limit wording

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

    @integration
    Scenario: A failed refresh of the same period keeps the chart on the card
      Given a widget whose query answered for the last 7 days
      When the board refreshes on its schedule, the window ends later, and the run fails
      Then the card still shows the widget's own face
      # A refresh is the same selection with only its end moved

    @integration
    Scenario: A query that fails after the period changes shows the failed state
      Given a widget whose query answered for the last 7 days
      When the reader chooses the last 30 days and the query fails
      Then the card says it couldn't load the widget

    @integration
    Scenario: Changing to another period of the same length starts the widget over
      Given a widget whose query answered for the last hour
      When the reader chooses Live and the query fails
      Then the card says it couldn't load the widget
      And the rows of the last hour are not shown under the Live label

    @integration
    Scenario: Saving new code with the same queries starts the widget over
      Given a widget that failed on a limit
      When its code is saved with the same queries
      Then the card no longer shows the failed state

    @integration
    Scenario: A failed card goes back to loading while a new period runs
      Given a widget that failed to load
      When the reader chooses another period
      Then the card shows its loading skeleton in place of the failed state

  Rule: A widget says it is loading until its data arrives

    A board opens with every widget's queries in flight. A card that stays blank reads as
    broken, so the frame covers it with a skeleton until the first answer, and says so when
    that takes long.

    @integration
    Scenario: A widget shows a loading skeleton while its first query runs
      Given a widget on a board
      When none of its queries has answered yet
      Then the card shows a loading skeleton in place of the chart
      And the skeleton is gone once a query answers

    @integration
    Scenario: A widget that loads for long says it is still loading
      Given a widget on a board
      When none of its queries has answered after 5 seconds
      Then the skeleton says "Still loading…"

    @integration
    Scenario: A refresh keeps the chart, with no skeleton
      Given a widget whose query answered once
      When the board refreshes and the query runs again
      Then the card shows no loading skeleton

    @integration
    Scenario: A widget with nothing to wait for shows no skeleton
      Given a widget with no queries, whose code reported an error, or whose code has loaded and has no query open or waiting to retry
      Then the card shows no loading skeleton

    @integration
    Scenario: A widget whose code is still loading keeps its skeleton
      Given a widget on a board whose code has not loaded yet
      When the frame is up with no query open
      Then the card still shows the loading skeleton

    @integration
    Scenario: A widget waiting to retry a busy query keeps its skeleton
      Given a widget on a board whose first query was refused as busy
      When the frame waits to retry it with no query open
      Then the card still shows the loading skeleton

    @integration
    Scenario: A member's Retry after a code error brings the skeleton back
      Given a widget whose code reported an error and which shows no skeleton
      When the member presses Retry
      Then the card shows the loading skeleton while the next load is pending

    @integration
    Scenario: A query that starts after the frame was idle brings the skeleton back
      Given a widget whose frame had nothing to wait for and whose queries never answered
      When a query starts
      Then the card shows the loading skeleton again

    @integration
    Scenario: The loading skeleton covers a running frame, never its restart notice
      Given a widget whose frame is given a loading skeleton to draw over itself
      When the frame is running
      Then the skeleton is drawn over the chart frame
      And when the frame stops responding and is restarting, the restart notice shows and the skeleton does not

  Rule: An empty widget says how to get its data

    An empty card says what is not there and what sends it: the SDK call, the setting or the
    integration. A quiet period in a project that sends data is not a setup step, so it
    offers none.

    @integration
    Scenario: A widget in a project that never sent a trace says how to send one
      Given a widget on a board in a project that has never received a trace
      When its query answers with completeness state "no_traffic" over traces
      Then the card says "No traces in this period" and "Send traces with the LangWatch SDK to fill this widget."
      And "Set up tracing" opens the traces page

    @integration
    Scenario: A quiet period offers no setup
      Given a widget on a board in a project that has received traces
      When its query answers with completeness state "no_traffic" over traces
      Then the card says "No traces in this period" and offers no "Set up tracing"

    @unit
    Scenario: An empty widget names what sends its data
      Given a field or a unit a widget's query found none of
      When the guidance is written
      Then UserId reads "Send user_id in the trace metadata with the LangWatch SDK."
      And TotalCost names the model, the token counts and a model price in Settings
      And evaluations read "Evaluations come from the evaluators you run on your traces."
      And a trace field with no words of its own reads "Send <field> on your traces with the LangWatch SDK."
      And a field of another unit with no words of its own gets no line, never the unit's no-traffic line

    @integration
    Scenario: The setup view says how to send the field it needs
      Given a widget on a board
      When its query answers with completeness state "missing" for the field UserId
      Then the card names the field and says "Send user_id in the trace metadata with the LangWatch SDK."

    @integration
    Scenario: The frame tells its card when the widget shows no data
      Given a widget on a board
      When it shows no traffic, the setup view, or every query returned no rows
      Then the frame tells its card the widget is empty
      And a widget with rows, or still loading, is not empty

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

  Rule: A board says once when several widgets failed on a limit

    @integration
    Scenario: Two widgets that failed on a limit are told once above the board
      Given a board of three widgets
      When two of them end on a memory or time limit failure
      Then a warning says "2 of 3 widgets hit a limit"
      And it says LangWatch limits the memory and time a widget's query may use, and that this is not a problem with the data
      And it offers no retry for all and no shorter period

    @integration
    Scenario: One widget that failed on a limit leaves the board without the line
      Given a board of three widgets
      When one of them ends on a memory or time limit failure
      Then no warning shows above the board

    @integration
    Scenario: Every widget failing on a limit says all hit a limit
      Given a board of three widgets
      When all three end on a memory or time limit failure
      Then a warning says "All 3 widgets hit a limit"
      And it says LangWatch limits the memory and time a widget's query may use, and that this is not a problem with the data

    @integration
    Scenario: The warning goes when a widget recovers
      Given a board whose two widgets failed on a limit
      When one of them is retried and loads
      Then the warning goes

    @integration
    Scenario: A widget that ended on a limit stops counting when its card leaves
      Given a board widget that ended on a memory or time limit failure
      When its card is replaced, such as by the empty sources view
      Then the board no longer counts that widget

    @integration
    Scenario: Failures that are not limits are not counted
      Given a board of three widgets
      When two of them fail for another reason, or one fails on a limit and one for another reason
      Then no warning shows above the board
