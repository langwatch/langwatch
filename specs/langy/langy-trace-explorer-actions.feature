Feature: Langy drives and reads the Trace Explorer

  As someone asking Langy to find traces
  I want Langy to fill the filters on the screen I am looking at, and to tell me the count that screen shows
  So that its answer and my screen are the same search, and I can keep working from where it left off

  The shape:
  - The Trace Explorer registers typed UI actions with Langy while it is open, the same channel
    the evaluations workbench uses (specs/langy/langy-ui-actions.feature). Each action is one
    pure transform of the Explorer's page state (specs/traces-v2/explorer-actions.feature).
  - With no Explorer open, the actions that change what is searched answer a link that opens the
    Explorer in that state. Actions that only make sense on an open page are refused.
  - The skill decides how Langy works from what was asked. Finding or listing traces is the ask
    (primary): Langy goes to the Explorer and drives it. Traces are a means to another task
    (secondary): Langy stays where the user is and answers with cards that link to the Explorer.
  - Langy searches with the window and the filter the page holds, and the search API leaves out
    the same origins the Explorer leaves out, so the two counts are counts of the same thing.

  # ---------------------------------------------------------------------------
  # The manifest
  # ---------------------------------------------------------------------------

  Rule: The Explorer's actions are typed, permissioned and advertised

    @unit
    Scenario: Every explorer action names its payload schema and permission
      Given the explorer action manifest
      Then each action has a payload schema and a permission
      And every action that changes the view needs traces:view

    @unit
    Scenario: Running an Instant Eval from Langy needs analytics:manage
      Given the explorer action manifest
      Then explorer.runInstantEval needs analytics:manage

    @unit
    Scenario: An explorer payload the schema refuses never reaches the page
      When explorer.setTimeRange is given neither a preset nor a window
      Then the payload is refused by the schema

    @unit
    Scenario: The traces page chips advertise live UI actions
      Given a turn whose context carries the Explorer's view chip
      When the turn context is rendered for the model
      Then it says the page accepts live UI actions

    @integration
    Scenario: The Trace Explorer registers its actions with Langy while it is open
      When the Trace Explorer mounts
      Then Langy holds a handler for every explorer action

    @integration
    Scenario: explorer.setFilter applies the filter on screen and answers what was applied
      Given the Trace Explorer is open
      When Langy calls explorer.setFilter with "event:thumbs_up_down"
      Then the search bar holds that query
      And the answer names the query applied

    @integration
    Scenario: explorer.getState answers the live page state
      Given the Trace Explorer is open on a filter with 7 matching traces
      When Langy calls explorer.getState
      Then the answer says source live, the query, the window and 7 traces

    @integration
    Scenario: explorer.runInstantEval starts under the same cost rule as the search bar
      Given the Trace Explorer is open
      When Langy calls explorer.runInstantEval with a question
      Then the Explorer's Instant Eval route is given that question, the other chips and the window

  # ---------------------------------------------------------------------------
  # Away fallback
  # ---------------------------------------------------------------------------

  Rule: With no Explorer open, a search action answers a link

    @unit
    Scenario: With no Explorer open a filter action answers a link to the Explorer
      Given no page claims the action
      When explorer.setFilter runs on the backend with "status:error"
      Then the answer carries a link to the Explorer with that query
      And the link is labelled "View in Trace Explorer"

    @unit
    Scenario: With no Explorer open a time range action answers a link with that window
      Given no page claims the action
      When explorer.setTimeRange runs on the backend with the preset "7d"
      Then the answer's link carries the preset "7d"

    @unit
    Scenario: With no Explorer open getState answers the saved defaults
      Given no page claims the action
      When explorer.getState runs on the backend
      Then the answer says source saved, the default lens and the default window
      And it carries no count

    @unit
    Scenario: An action that needs an open page is refused without one
      Given no page claims the action
      When explorer.select runs on the backend
      Then the dispatch answers langy_ui_no_browser

    @unit
    Scenario: A filter the language refuses is refused on the backend too
      Given no page claims the action
      When explorer.setFilter runs on the backend with a query that does not parse
      Then the dispatch answers langy_ui_handler_failed naming filter_invalid

    @integration
    Scenario: The card for an answered link opens the Trace Explorer
      Given explorer.setFilter answered a link because no page was open
      When Langy's result card renders
      Then the card's link reads "View in Trace Explorer"
      And it opens the Explorer on the answered query

  # ---------------------------------------------------------------------------
  # Defaults aligned
  # ---------------------------------------------------------------------------

  Rule: Langy's search and the Explorer count the same traces

    @unit
    Scenario: A trace search that names no origin leaves out Langy's own traces
      When the search API is asked for traces with no origin named
      Then the read excludes the Langy origin, as the Explorer does

    @unit
    Scenario: A trace search whose filter names an origin is left as asked
      When the search API is asked for traces with the filter "origin:langy"
      Then the read excludes no origin

    @unit
    Scenario: A trace search whose origin flag names an origin is left as asked
      When the search API is asked for traces with the origin filter "evaluation"
      Then the read excludes no origin

    @unit
    Scenario: The Explorer link carries the search's filter
      Given Langy ran a trace search with a filter in the trace filter language
      When the card builds its Explorer link
      Then the link's query is that filter, unquoted

    @unit
    Scenario: The Explorer link carries errors only as a status filter
      Given Langy ran a trace search with errors only
      When the card builds its Explorer link
      Then the link's query includes "status:error"

    @unit
    Scenario: The Explorer link keeps the lens the caller names
      Given the user is on a saved view that shows every trace as flat rows
      When the card builds its Explorer link naming that view
      Then the link opens that view instead of the default lens

    @unit
    Scenario: A lens that would change the result set is not kept
      Given the user is on a lens with a filter of its own, or a grouped lens
      When the card asks which lens its link should open
      Then the answer is none, and the link opens the default lens

  # ---------------------------------------------------------------------------
  # The skill
  # ---------------------------------------------------------------------------

  Rule: The skill decides between driving the Explorer and answering with cards

    @unit
    Scenario: The skill states the primary and the secondary way of working
      Given the find-traces skill
      Then it says to open the Explorer and drive explorer.setTimeRange and explorer.setFilter when finding traces is the ask
      And it says to stay on the page and answer with cards and a link when traces are a means to another task

    @unit
    Scenario: The skill takes the window and the filter from the page
      Given the find-traces skill
      Then it says to search with the page's from, to and filter
      And it does not tell Langy to add an application origin

    @unit
    Scenario: The skill searches every form a concept can take before saying nothing was found
      Given the find-traces skill
      Then it says to read the trace filter reference first
      And it says to list a field's values before guessing one
      And it names events, annotations and evaluator results as forms of user feedback
      And it says to widen the window before reporting nothing

    @unit
    Scenario: The routing table sends trace-finding asks to the find-traces skill
      Given Langy's routing table
      Then "find traces" asks are routed to find-traces
      And the committed compiled skill matches a fresh render of its source

    @e2e
    Scenario: Asked for thumbs-down traces, Langy applies the event filter and answers the Explorer's count
      Given a project where thumbs down exists only as thumbs_up_down events with a vote of -1
      When the user asks for the traces with a thumbs down
      Then the event filter reaches the Explorer through explorer.setFilter
      And the count in the answer equals the Explorer's count for that filter and window
