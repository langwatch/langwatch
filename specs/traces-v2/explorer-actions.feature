Feature: The Trace Explorer is one store with pure transforms

  As someone, or an agent, changing what the Trace Explorer shows
  I want every change to the page state to be one pure function over one state
  So that a click, a URL and an agent action all reach the same result, and the same function runs without a page

  The shape:
  - The page state is one slice of one store: the query, the window, the lens, the sort, the
    grouping, the columns, the page, the page size, the selection, the open rows and the
    Instant Eval runs behind the query's chips.
  - A transform takes that state and a payload and answers the next state plus a small result.
    It reads nothing else, so it can be unit-tested and run on the server.
  - A transform refuses with a code from a closed list. The state it was given is never changed
    by a refusal.
  - The store commits a transformed state through its own actions, so the derived parts of the
    store (the parsed query, the keyset cursors, the lens drafts) follow.
  - A read projection answers the page state together with the count the header shows.

  See dev/docs/adr/140-the-explorer-is-one-store-with-pure-transforms.md.

  # ---------------------------------------------------------------------------
  # Filter
  # ---------------------------------------------------------------------------

  Rule: The filter transform owns the query

    @unit
    Scenario: A filter transform replaces the query and returns to the first page
      Given the Explorer is on page 3 with the query "status:error"
      When the filter transform is given "model:gpt-5-mini"
      Then the query is "model:gpt-5-mini"
      And the page is 1

    @unit
    Scenario: A filter added to the query is joined with AND
      Given the Explorer has the query "status:error"
      When the filter transform is given "model:gpt-5-mini" in add mode
      Then the query is "status:error AND model:gpt-5-mini"

    @unit
    Scenario: A filter the language refuses leaves the state untouched
      Given the Explorer has the query "status:error"
      When the filter transform is given a query that does not parse
      Then the transform refuses with filter_invalid
      And the query is still "status:error"

    @unit
    Scenario: A facet toggled twice is excluded, and a third time is neutral
      Given the Explorer has no query
      When the facet transform is given status error three times
      Then the query reads "status:error", then "NOT status:error", then nothing

    @unit
    Scenario: A second value of one field joins the first with OR
      Given the Explorer has the query "origin:application"
      When the facet transform is given origin evaluation
      Then the query reads "(origin:application OR origin:evaluation)"

  # ---------------------------------------------------------------------------
  # Window
  # ---------------------------------------------------------------------------

  Rule: The time range transform owns the window

    @unit
    Scenario: A preset window is resolved at apply time and keeps its preset id
      When the time range transform is given the preset "7d"
      Then the window is seven days wide and ends now
      And the window carries the preset id "7d"

    @unit
    Scenario: An absolute window must end after it starts
      When the time range transform is given a window that ends before it starts
      Then the transform refuses with time_range_invalid

    @unit
    Scenario: An unknown preset is refused by name
      When the time range transform is given the preset "fortnight"
      Then the transform refuses with preset_unknown

  # ---------------------------------------------------------------------------
  # Lens, sort, grouping, pages
  # ---------------------------------------------------------------------------

  Rule: The view transforms own the lens, the sort, the grouping and the pages

    @unit
    Scenario: A lens transform installs the lens's own filter, sort, grouping and columns
      Given the page holds the lens "errors"
      When the lens transform is given "errors"
      Then the state carries that lens's filter, sort, grouping and columns
      And the page is 1

    @unit
    Scenario: A lens the page does not hold is refused
      Given the page holds its built-in lenses
      When the lens transform is given "no-such-lens"
      Then the transform refuses with lens_not_found

    @unit
    Scenario: A sort change returns to the first page
      Given the Explorer is on page 4
      When the sort transform is given cost descending
      Then the sort is cost descending
      And the page is 1

    @unit
    Scenario: A grouping change closes the open rows
      Given two rows are open
      When the grouping transform is given by-conversation
      Then the grouping is by-conversation
      And no row is open

    @unit
    Scenario: A page past the last one is refused
      Given the last read counted 120 rows at 50 per page
      When the page transform is given page 4
      Then the transform refuses with page_out_of_range

    @unit
    Scenario: A page size outside the offered sizes is refused
      When the page size transform is given 37
      Then the transform refuses with page_size_invalid

  # ---------------------------------------------------------------------------
  # Selection and rows
  # ---------------------------------------------------------------------------

  Rule: The selection and the open rows are page state

    @unit
    Scenario: A selection holds only ids that address a trace
      When the select transform is given two trace ids and a blank one
      Then the selection holds the two trace ids

    @unit
    Scenario: Selecting all matching rows drops the explicit ids
      Given two traces are selected
      When the select transform is given all matching
      Then the selection is all matching with no explicit ids

    @unit
    Scenario: Expanding a row exclusively closes the others
      Given the row "conversation-a" is open
      When the expand transform opens "conversation-b" exclusively
      Then only "conversation-b" is open

    @integration
    Scenario: Open rows leave the component and survive a remount
      Given a conversation row is open in the Conversations lens
      When the table unmounts and mounts again
      Then the same conversation row is still open

  # ---------------------------------------------------------------------------
  # Commit and read
  # ---------------------------------------------------------------------------

  Rule: A transformed state is committed through the store's own actions

    @unit
    Scenario: A committed filter is parsed and returns the list to its first page
      Given the store is on page 2 with keyset cursors
      When a transformed state with a new query is committed
      Then the store holds the parsed query, page 1 and no cursors

    @unit
    Scenario: A committed lens installs the lens through the lens action
      When a transformed state naming another lens is committed
      Then the store's active lens, sort and grouping are that lens's

    @integration
    Scenario: The fragment is written from the merged store
      Given the Trace Explorer is open
      When a transformed state with a query, a preset and a lens is committed
      Then the URL fragment names that lens, query and preset

  Rule: The read projection answers the page as the user sees it

    @unit
    Scenario: The live read carries the count the header shows
      Given the last read counted 412 traces on the page state
      When the page state is read
      Then the read says source live, 412 traces, and the ids on the page

    @unit
    Scenario: The live read lists the facets active in the query
      Given the query "status:error AND NOT model:gpt-5-mini"
      When the page state is read
      Then the active facets are status error included and model gpt-5-mini excluded

    @unit
    Scenario: The live read names a running Instant Eval's progress
      Given an Instant Eval run behind the query has judged 3200 of 10000 rows with 412 matched
      When the page state is read
      Then the read carries that run's judged, total and matched counts
