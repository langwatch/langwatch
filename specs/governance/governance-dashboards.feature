@governance @dashboards
Feature: Governance dashboards — four cost widgets, sample answers only
  A governance page that draws four cost widgets in the product's own
  dashboard format, so the shape a finished governance dashboard will
  have can be seen and judged before anything real can be read.
  The figures are invented, in the browser, every time.

  The hard rule: this page never writes. Not a widget, not a dashboard,
  not a layout, not a preference, not a seeded row, and not a demo
  project standing in for a real one. A reader who opens it leaves no
  trace behind, in either state of the sample choice.

  That rule is about rows, not about controls. The editor behind each
  widget is the product's own and is offered whole — Save included —
  because a stripped copy of it would teach the reader that this page is
  a mock-up rather than the product. What an edit cannot do is outlive
  the visit: it is kept in the open page and the reload takes it away.

  Real reads are deferred, and for one reason: the cost rollup the
  widgets want is not in the query catalog yet, so no query written
  here could reach it. Rather than dress an unanswerable query as a
  broken one, sample off simply does not mount the chart and says what
  would fill it. When the rollup lands, the same four queries answer
  from it and the empty state stops being reachable.

  The sample choice itself is not this page's to make: it is the
  section-wide one, and the rule for it lives in
  specs/ai-governance/dashboard/governance-ui-controls.feature —
  one choice for every governance page, toggle top-right, banner
  directly under the header.
  Decision: none — preview UI, reversible, no stored state.

  Background:
    Given an organization member with the governanceCost:view permission
    And "release_ui_governance_billed_cost_enabled" is enabled
      for the organization

  # ---------------------------------------------------------------------------
  # Reachability — the same gate Costs already uses
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The page stays behind the billed-cost release flag
    Given "release_ui_governance_billed_cost_enabled" is disabled
      for the organization
    When the member cold-loads "/governance/dashboards"
    Then the not-found scene renders
    And a member without the governance cost permission sees the access-restricted notice instead
    # Unlisting the entry is not gating the page. The route guards itself,
    # so a pasted link is worth no more than a hidden nav item.

  @integration
  Scenario: The page is listed in the governance rail next to Costs
    When the member opens the governance rail
    Then "Dashboards" is listed directly after "Costs"
    And it is absent from the rail whenever the billed-cost flag is off
    # It sits beside Costs because it shows the same money in another
    # shape; a reader who wants the figures charted is already there.

  # ---------------------------------------------------------------------------
  # The four widgets
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Four cost widgets are laid out on the grid
    When the member opens "/governance/dashboards"
    Then the page holds exactly four widgets: "Spend over time by provider",
      "Cost by department", "Cost by person", "Cost by model and agent"
    And the provider chart and the model chart each span the full width of the grid
    And the department and person widgets sit side by side between them
    # Four, and only four: every one of them answers a question a cost
    # owner already asks on the Costs page, and nothing here is a filler
    # chart added to make the grid look inhabited.

  @integration
  Scenario: A card stays where the reader drags it
    When the member drags a card to another row and drops it
    Then the card stays in its new row
    And it is still there after the page renders again
    But the authored arrangement is back on the member's next visit
    # The grid is draggable by construction, so a card that springs back to
    # where it started reads as a bug rather than as a locked layout. There is
    # no row behind this page to save an arrangement to, and the page may not
    # grow one, so the move lasts the visit and no longer.

  @integration
  Scenario: Sample on fills every widget from invented figures
    Given sample mode is on
    When the page renders
    Then every widget draws a chart from invented figures
    And the banner under the header says nothing on the page is real
    And no request leaves the browser
    # The invented figures are the ones the rest of the governance
    # section already invents, so a reader moving between pages sees one
    # consistent imaginary organization rather than four unrelated ones.

  @integration
  Scenario: Sample off shows an empty widget that says what would fill it
    Given sample mode is off
    When the page renders
    Then no chart is drawn on any widget
    And each widget names what would appear in it and what has to happen first
    And the sample choice is offered once, in the page header
    And no error alert is on the page
    # Nothing failed, so nothing may claim to have failed. The figures are
    # simply not readable yet, and the widget says that in as many words
    # rather than rendering a chart of nothing or a red card.
    #
    # The choice is one choice, so it is offered in one place. A button on
    # every empty card repeats the same section-wide switch four times over
    # and reads as four separate decisions.

  @integration
  Scenario: The editor draws no invented figures the reader has turned off
    Given sample mode is off
    When the member opens the query behind one widget from that widget's card
    Then the statement that widget asks is still shown
    And no chart is drawn in the editor either
    And running the statement says the sample choice is off rather than
      answering with invented figures
    # Sample off is a request: do not show me invented figures. It is also the
    # state the page opens in, and the banner that says the figures are
    # invented is only shown with sample ON. So a chart drawn inside the
    # editor while sample is off is invented money on screen with nothing
    # anywhere saying so — the exact thing this page exists not to do.
    #
    # The statement stays readable in both states, because it is not a figure.
    # It is the question, and the question is true whether or not anybody has
    # agreed to see invented answers to it.

  @integration
  Scenario: Every widget is drawn in the colour mode the reader is in
    Given the member is reading in dark mode
    When the page renders
    Then every chart is drawn dark
    And every chart is drawn light for a member reading in light mode
    # The chart runs in a sandboxed frame, so the author code inside it has
    # no way of its own to see the page around it. A chart fixed to one mode
    # paints white panels down a dark page.

  @integration
  Scenario: The member can open the query behind one widget from its own card
    When the member opens the query behind one widget from that widget's card
    Then the product's own widget editor opens on that widget
    And it carries that widget's name and previews that widget's chart
    And its queries tab shows the statement that widget asks
    # The figures on this page are invented, and the page says so. What it
    # cannot say in a banner is WHICH question each chart is a picture of.
    # The statement is the answer, and it is offered on the card it belongs
    # to rather than in one list of four, so the chart and the question
    # behind it are read side by side.
    #
    # The editor is the product's own, whole, rather than a look-alike that
    # only displays. A surface that shows a Run it cannot honour, or hides
    # the controls the same editor offers everywhere else, teaches the
    # reader that this page is a mock-up of the product rather than the
    # product.

  @integration
  Scenario: Running a statement in the editor answers from the invented figures
    Given the member has the widget editor open on a widget
    When the member runs that widget's statement
    Then the answer is the same invented figures that widget's chart draws
    And no request leaves the browser
    # Run is honoured rather than removed, and it is honoured by the only
    # source of figures this page has. The alternative — a Run that reaches
    # for a catalog entry that does not exist — fails in a way that reads as
    # a broken page rather than as an unbuilt one.

  # ---------------------------------------------------------------------------
  # Honesty — the page is a picture, not a workspace
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Nothing on the page itself can save a widget or a dashboard
    When the member opens "/governance/dashboards" in either sample state
    Then no control on the page is offered to add, rename, duplicate or
      delete a widget or a dashboard
    And no control is offered to save or share the page
    And nothing the member does on the page writes a row
    # The page is the picture; the editor behind a widget is the product's
    # own and is covered by its own scenarios. What the page itself must
    # never grow is a second, half-built set of the same controls.

  @integration
  Scenario: An edit made in the editor lasts the visit and no longer
    Given the member has changed a widget in the editor and saved it
    When the widget is read again during the same visit
    Then it carries the change
    And the next visit opens on the widget the repository authored
    And nothing the member did wrote a row
    # The editor is whole, so Save is honoured rather than disabled — a
    # button that looks live and does nothing is the lie this page is built
    # to avoid. What Save cannot do here is outlive the visit: the four
    # widgets are authored in the repository and there is no row behind
    # them, so the change is kept where every other unsaved thing on this
    # page is kept, in the open page, and the reload says plainly that it
    # was never written.

  @unit
  Scenario: Every widget definition is a valid dashboard widget
    When each of the four widget definitions is read
    Then each is accepted by the product's own dashboard widget format
    And each names the query that fills it
    # Same format as a customer's own widgets, checked the same way. If
    # this page needed a private dialect of the format, the format would
    # be the thing that is wrong.

  @unit
  Scenario: A sample answer names exactly the columns its query names
    Given a widget's query asks for a set of columns
    When the sample answer for it is produced
    Then the answer carries those columns and no others
    # A chart that reads a column the answer does not carry draws blank,
    # and a chart quietly ignoring an extra one hides a mismatch until
    # real figures arrive. Exactly, in both directions.

  @unit
  Scenario: A sample answer spans the time frame in view
    Given a widget over a chosen time frame
    When the sample answer for it is produced
    Then its figures run from the start of that time frame to its end
    # Otherwise the invented chart is a thin stripe in a wide axis, and
    # the reader judges a layout the real figures will never produce.

  @unit
  Scenario: A ranked sample answer arrives in the order its query asks for
    Given a query that orders its rows by what they cost
    When the sample answer for it is produced
    Then the rows arrive biggest first
    # The chart draws the rows in the order it receives them, so an answer
    # in any other order paints a ranked panel unranked while the query
    # beside it promises otherwise.

  @unit
  Scenario: Every widget invents money on one scale
    Given the four widgets describe one organization
    When each is answered over the same time frame
    Then the ranked figures are the same size of money as the charted ones
    And narrowing the frame shrinks them with it
    # A department panel reading a tenth of the person panel beside it
    # teaches a reader that the screen does not add up rather than what
    # the organization spends. Every figure is therefore scaled from one
    # monthly top carried across the buckets the frame holds.

  @unit
  Scenario: A query with no sample answer is refused, not invented
    Given a query nothing has been written to answer
    When an answer for it is asked for
    Then the request is refused
    # A guessed answer to an unrecognised query would let a widget ship
    # with a query nobody wrote figures for and still look finished.

  Rule: Sample answers never reach a database

    @unit
    Scenario: Sample answers are produced without a project or a tenant
      Given no project and no tenant are in hand
      When a sample answer is produced for each of the four queries
      Then every one is produced
      # Nothing to key a read on is the proof, not the inconvenience: an
      # answer factory that never takes an identifier cannot reach a row,
      # and the chart's surroundings carry no project for it to borrow.
