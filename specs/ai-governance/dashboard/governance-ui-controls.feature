Feature: The controls every AI Governance page renders the same way
  As an admin who moves between Home, Costs, Inventory, Agents and People
  I want each page's filters, actions and sample data to look and behave alike
  So that a control I learned on one page is the same control on the next

  @integration @regression
  Scenario: Switching governance tabs unmounts the inactive content
    Given a governance page with a populated tab
    When the reader switches to another tab
    Then the previous tab's content is removed from the document

  # ---------------------------------------------------------------------------
  # This file is the section's UI rulebook. It exists because the Costs page
  # got two things right that nothing wrote down, and five more pages were
  # about to get them wrong five different ways: the sample-data toggle with
  # its amber banner, and the filter pill that reads "Department · All
  # departments ⌄".
  #
  # The hardest rule first, because it is the one a page breaks by accident.
  # A governance page NEVER offers a native <select> for a reader to operate.
  # A native select is the operating system's widget: it cannot carry the
  # pill's icon or its label-plus-value reading, it ignores the app's palette,
  # and on a dark screen it opens a light list. Every choice on a governance
  # page is either a FilterChip (a menu pill, from
  # ~/components/governance/filters) or ~/components/ui/select — both of which
  # the reader operates through a button and a listbox.
  #
  # One honest exception, and it is not ours to remove: the app's own select
  # mounts a <select> underneath (Ark's HiddenSelect) so that browser autofill
  # and a plain form submit keep working. Ark gives that element BOTH
  # aria-hidden="true" AND tabindex="-1", so no reader reaches it by pointer,
  # by tab or by screen reader, and counting it would make the rule impossible
  # to satisfy for the very component the rule points pages at. So
  # `findNativeSelects(container)` skips a select that is BOTH aria-hidden and
  # out of the tab order, read off the element ITSELF, and nothing else. The
  # helper is exported from the same place as the chips.
  #
  # It reads the element and not its ancestors on purpose, and the reason is a
  # trap worth naming: Ark marks the whole page aria-hidden while a modal is
  # open. An ancestor-walking check therefore reported "no native selects" for
  # any page with a dialog up, whatever that page actually rendered — the rule
  # passing because it had stopped looking. A select behind a dialog is still
  # reachable once the dialog closes, so an inherited aria-hidden is not
  # evidence of anything.
  #
  # The shared implementations these scenarios describe:
  #   - platform/app/src/components/governance/filters/  — FilterChip,
  #     FilterChipRow, SortChip, the time-control options, findNativeSelects
  #   - platform/app/src/components/governance/sample/   — useSampleMode,
  #     SampleDataToggle, SampleDataBanner
  #
  # BINDING STATE. The @unit scenarios below are bound to the shared kit's own
  # tests and enforced today. The @integration scenarios are page-level: they
  # describe what each of the five pages must do with the kit. They started out
  # carrying @unimplemented and losing it as each page bound one; all but one
  # have now been bound, so treat the tag as the exception rather than the
  # default. A page binds a scenario by dropping @unimplemented from it and
  # adding `/** @scenario "<title>" */` — ONE LINE, sharing the JSDoc opening —
  # to the test that covers it. Every scenario title here is a single line for
  # exactly that reason.
  #
  # WHY "ONE LINE" IS LOAD-BEARING, and this paragraph has now been wrong in
  # both directions, so it is written with executed numbers rather than a
  # reading of the source.
  #
  # An earlier version said a multi-line JSDoc is rejected. A later version
  # "corrected" that to say a multi-line JSDoc binds perfectly well. THE
  # SECOND WAS THE WORSE ERROR, because it told agents to write the form that
  # silently binds nothing, and it was believed.
  #
  # What is actually true, and it takes two functions to see:
  #
  #   1. ANNOTATION_RE (platform/app/scripts/check-feature-parity.ts:1003) DOES
  #      match an `@scenario` on a continuation line — the `\*` in its
  #      alternation is that marker. This much the old correction got right,
  #      and it is why reading only the regex misleads.
  #   2. `isFollowedByTestCall` (:1108) then decides whether the annotation is
  #      kept, by scanning forward from where the match ENDED. It skips
  #      whitespace, has a case for a comment that OPENS (`/*` at :1117, `//`
  #      at :1123), and has NO CASE FOR A CLOSING `*/`. Inside a multi-line
  #      block the very next thing it meets is that `*/`, so it falls through
  #      to `rest.match(/^(?:it|test)…/)` at :1130 and returns false.
  #      `collectAllBindings` (:1148) drops the annotation on a bare
  #      `continue`, printing nothing.
  #
  # So the ONLY form that binds is one where the annotation shares its line
  # with the closing marker:
  #
  #     /** @scenario "The title" */          ← binds
  #     it("…", …)
  #
  #     /**                                    ← binds NOTHING, silently
  #      * @scenario "The title"
  #      */
  #     it("…", …)
  #
  # The regex tail `[ \t]*(?:\*\/|$)` consumes the `*/` in the first form,
  # which is precisely what lets the forward scan reach `it(`. Stacking two
  # single-line annotations above one test is fine and is done today.
  #
  # MEASURED, not argued (a faithful replay of both functions over all 3508
  # test files): 11891 annotations, 117 of them dropped in silence, across 54
  # files. This is not a governance curiosity — it is repo-wide. The gate on
  # this very branch went red because four governance scenarios were bound
  # this way and the checker discarded three of them.
  #
  # A scenario TITLE that wraps across a newline breaks too, separately: the
  # quoted group cannot cross one, so the bare-title branch captures the first
  # line including its opening quote and binds a phantom matching no scenario.
  # Every scenario title in this file is kept on one line for that reason as
  # well as the one above.
  #
  # And the checker matches on the comment alone. It never reads what a test
  # asserts, and it accepts any number of tests claiming one scenario without
  # complaint. So a binding is a promise made by whoever wrote it: annotate the
  # test that actually exercises the scenario's Given and When, and leave a
  # test that merely touches the same helper unbound.
  #
  # Companion specs:
  #   - specs/governance/governance-cost-screen.feature (the sample rule's origin)
  #   - specs/ai-governance/dashboard/people-tabs.feature
  # ---------------------------------------------------------------------------

  # ===========================================================================
  # Choice controls
  # ===========================================================================

  @unit
  Scenario: A filter chip renders a menu pill rather than a native select
    Given a governance page offers a choice of department
    When the chip renders
    Then the control is a pill button that opens a menu
    And no native select element exists anywhere in the rendered page

  @unit
  Scenario: A filter chip names what it filters and the value in view
    Given a department chip with Engineering selected
    When the chip renders
    Then it reads as the name of the filter followed by the value in view
    And neither word is abbreviated

  @unit
  Scenario: A filter chip opens its options as a menu
    Given a department chip with one department behind it
    When the reader opens the chip
    Then the department is offered as a menu item

  @unit
  Scenario: A choice that cannot apply is offered as disabled rather than removed
    Given a chip whose choices cannot apply to the current view
    When the chip renders
    Then the chip is on screen and disabled
    And it is not removed, because a control that vanishes explains nothing

  @integration
  Scenario: No governance page renders a native select
    Given each of Home, Costs, Inventory, Agents and People
    When the page renders with data and again with none
    Then the page contains no native select element

  @integration
  Scenario: A choice too long for a pill uses the app's own select
    Given a choice with more options than a menu pill can hold comfortably
    When the page renders it
    Then it uses the app's own select component
    And still no native select element exists

  # ===========================================================================
  # Layout: where the controls sit
  # ===========================================================================

  @unit
  Scenario: Filters and sort share one row under the page header
    Given a page with a department filter and a sort control
    When the row renders
    Then both are chips in the same row
    And the row wraps rather than scrolling, so no chip is lost on a narrow window

  # "DIRECTLY under the page header" is what this clause used to say, and the
  # Agents page stopped satisfying it the moment its filter row was lifted out
  # of the content region: the tab list now sits between the header and the
  # filters, which is correct, because a filter that narrows one pane belongs
  # above that pane and below the control that chooses it. The older wording
  # would have graded that improvement as a regression.
  #
  # What the rule was always protecting is two things the word "directly" was
  # only a proxy for: the controls are together in ONE row, and that row is
  # ABOVE the thing it narrows rather than inside it. A tab list may intervene.
  # Nothing that is itself filtered may.
  #
  # WHICH PAGES ACTUALLY EXERCISE THIS. Agents and Costs do; each renders a
  # real filter row and each has something between that row and its header —
  # a tab list on one, a sample banner on the other — which is the case the
  # reworded clause exists to permit. Inventory does NOT: it renders no filter
  # and no sort control anywhere, so all five clauses hold there vacuously.
  # Recorded because a reader counting three governance pages would otherwise
  # read Inventory as a third confirmation, and a page that satisfies a layout
  # rule by having nothing to lay out confirms nothing. If filters are ever
  # added to Inventory, this note is stale and that page joins the other two.
  @integration
  Scenario: Every filter and sort control sits in one row above the content it narrows
    Given a governance page with filters and a sort control
    When the page renders
    Then all of them are in a single row
    And that row sits above the content they narrow, never inside it
    And nothing between that row and the page header is filtered by it
    And that row is left-aligned
    And no filter is rendered anywhere else on the page

  # "At most one is solid" is what this rule used to say, and it could not do
  # the job it was written for. Zero solid satisfies "at most one", so the rule
  # was green while the Agents page drew Register agent grey and the Inventory
  # page drew Add tool solid orange — the same slot, the same kind of action,
  # two different buttons, which is the drift the rulebook exists to stop. It
  # also said "the rest outline" while the bound test asserted the sample
  # toggle is ghost. Both were fixed by naming ONE treatment and applying it
  # everywhere, rather than by bounding how many treatments were allowed.
  #
  # THAT TIGHTENING STILL STANDS. What changed underneath it is only WHICH
  # treatment was chosen. The product owner rejected solid orange across the
  # governance section — the screenshot they sent back was the Inventory page
  # header drawn solid, and they named the empty states separately — so the
  # create action is now the house header button: outline, small, with a
  # leading plus glyph. That is the `HeaderButton` in
  # `src/components/ui/layouts/PageLayout.tsx`, which renders
  # `<Button variant="outline" size="sm">` and is what /settings/api-keys and
  # /settings/model-providers already use. Solid orange is gone from
  # governance BUTTONS entirely.
  #
  # READ THE PARAGRAPH ABOVE BEFORE LOOSENING THIS ONE. The reason "at most
  # one" failed was that it counted treatments instead of naming one, and a
  # rule that now said only "everything is outline" would fail the same way
  # from the other end: it would grade a page green while the create action,
  # the sample toggle and a filter reset all looked identical, which is the
  # drift by a different route. So the create action is still singled out, and
  # by three things that survive the loss of the fill — it sits in the header,
  # it carries the plus glyph, and it is the ONLY outlined control in that
  # row. Everything beside it is ghost.
  #
  # WHAT THIS RULE REACHES, stated because two things that are still orange
  # are orange on purpose and the next reader finishing the job would strip
  # them. It reaches PAGE-HEADER CREATE ACTIONS and EMPTY-STATE ACTIONS, which
  # is what the product owner pointed at. It reaches nothing else.
  #
  #   ORANGE AS A STATUS MARK IS NOT A BUTTON. The "Unclaimed" badge in
  #   `src/components/governance/agents/AgentCard.tsx` — and the same badge in
  #   `AgentsTable.tsx` beside it — is `variant="subtle" colorPalette="orange"`,
  #   and the badges in `EnvironmentsTab.tsx`, `TraceDestinationField.tsx` and
  #   `ToolCatalogCards.tsx` are the same shape. Each states a fact about
  #   a thing rather than offering a press. The section's colour rules further
  #   down govern marks and badges; this one governs controls.
  #
  #   A DRAWER FOOTER SUBMIT STAYS SOLID, and this was decided rather than
  #   overlooked. It is the app-wide convention outside governance too —
  #   `src/components/settings/DepartmentEditDrawer.tsx` pairs a ghost
  #   Cancel with a solid orange Save changes, and the governance drawers
  #   match it. A footer submit is not competing with a page's create action
  #   for the reader's eye, because the drawer is the only thing on screen
  #   when it is shown; the pair of buttons at its foot has to say which one
  #   commits, and the fill is how every drawer in this product says it.
  #   Draining it here would leave governance's drawers looking unlike the
  #   rest of the app to buy consistency the reader never sees.
  #
  # The "at rest" qualifier below is load-bearing, and it was missing on the
  # first attempt. The kit renders the toggle `active ? "subtle" : "ghost"`
  # (`SampleDataControls.tsx`), so a page whose samples are showing draws a
  # subtle toggle and is doing nothing wrong. A flat "is ghost" clause failed
  # Agents, which opens with samples on, while passing People, which opens
  # with them off — a rule that graded pages on their default state rather
  # than on their treatment. What the rule actually protects is the last
  # line: however the toggle is drawn, it is never a second solid competing
  # with the page's create action. Subtle is nowhere near solid.

  @integration
  Scenario: Primary page actions sit top-right in the page header
    Given a governance page offering actions such as Add tool, Register agent, Add department, Run match pass or See sample data
    When the page renders
    Then those actions sit at the top right of the page header
    And each is rendered at the small size
    And the action that creates the page's own thing is the house header button, which is outline and carries a leading plus glyph
    And it is the only outlined control in that row, which is what marks it out now that nothing is filled
    And every other action beside it is ghost, apart from the sample-data toggle while it is pressed
    And no action in that row is solid, in the brand orange or in any other colour
    And the sample-data toggle is ghost at rest, because it changes what is shown rather than the org
    And the sample-data toggle is subtle while pressed, and never solid in either state
    And an orange status badge, such as the one marking an agent unclaimed, is untouched by this rule, because a badge states a fact rather than offering a press

  # ===========================================================================
  # Create on top, and never nothing below
  # ===========================================================================
  #
  # Two rules that only make sense together.
  #
  # CREATE LIVES ON TOP. The inventory carried two create controls that opened
  # the same menu and created the same thing: a solid "Add tool" in the page
  # header and a second, outline "Add source" inside the sources table's own
  # header. A reader had to work out which of two differently-worded,
  # differently-weighted buttons was the real one. The reference is our own
  # api keys page at /settings/api-keys, which pairs its scope filter with a
  # single "Create new secret key" in the header.
  #
  # AND THE CONTENT ALWAYS SHOWS SOMETHING. The other half of the same
  # complaint: a pane that has nothing to list used to render a dashed box
  # holding one grey sentence. That fails a reader twice — it looks like a
  # component that failed to load rather than a page in a legitimate state,
  # and a box that only explains itself leaves them exactly where they were.
  #
  # The shape is shared and the words are not. Every governance page draws its
  # empty panes with the same component
  # (src/components/governance/empty/GovernanceEmptyState.tsx), whose shape
  # comes from the Langy empty state: a glyph, a serif headline, a sentence of
  # explanation, and somewhere to go. Langy's COPY is Langy's alone, and so is
  # every page's: a shared empty state that also shared its sentences would
  # put "Hey, I'm Langy!" on the inventory.

  # WHAT "ONE CREATE" MEANS, because the first draft of this rule said
  # "exactly one control" and that was too strong. It forbade the empty state
  # from offering the very action the reader is there to take, which is the
  # opposite of the Langy shape the owner pointed at, and it made the shared
  # empty state's own `action` prop unusable on any page with a header create.
  # The defect the owner actually reported was TWO DIFFERENT DOORS to one
  # room: a solid "Add tool" up top and an outline "Add source" below, worded
  # differently and weighted differently, so a reader had to work out which was
  # real. One flow, one label, one weight is what fixes that. A pane repeating
  # that same action inside its empty state is a second doorway to the same
  # door, and costs the reader nothing.
  @integration
  Scenario: A page offers one create flow, under one label, from its header
    Given a governance page whose content region can be created into
    And a reader granted the permission that create requires
    When one of its panes renders
    Then every control on that pane that opens the create flow carries the
      same label
    And every one of them is drawn at the same weight
    And at least one of them sits in the page header
    And no second control opens the same flow under a different label
    # Scoped to ONE PANE, deliberately, because the label may name what the
    # pane lists: the catalog says Add tool where the sources table says Add
    # source, and those panes list different views of the same object. Quantify
    # over panes instead and the rule reads as false on a page that is
    # behaving correctly. Within one pane there is one word for it.
    #
    # The grant is in the Given because the clause about the header is an
    # EXISTENCE claim. A reader without the permission sees no create control
    # at all, so "at least one sits in the header" would be false rather than
    # vacuous, and the rule would fail on the page's most careful behaviour.
    # What that reader sees instead is covered by the empty-pane scenario
    # below, whose trailing clause is about exactly this.

  @integration
  Scenario: An empty pane explains itself rather than sitting blank
    Given a governance pane with nothing to list
    When the pane renders
    Then it draws the section's shared empty state, with a glyph, a headline
      and a sentence saying what fills it
    And the sentence is that page's own words, never another page's
    And any action it offers is the page's existing create flow under the
      header's own label, never a new one
    # A reader who cannot create is not told to. The sentence changes with the
    # grant rather than pointing at a button that is not on their screen.

  # The weight rule below was living in a doc comment on
  # GovernanceEmptyStateAction, where the next page to use the component would
  # not have looked, and the Agents page duly broke it on the first try: all
  # three of its empty states passed no emphasis, so "Clear filters" rendered
  # as the same orange solid as "Register agent". The page had gone to the
  # trouble of branching on WHY a pane is empty and then drew both outcomes
  # identically, which throws the distinction away at the last step.
  #
  # RESOLVED, and recorded because the contradiction was real for a while and
  # the next reader deserves the decision rather than the argument. An earlier
  # draft of the clause above said an empty pane "carries no create control of
  # its own", which cannot stand beside the scenario below, and which the team
  # lead's review had already overruled in practice by accepting a create
  # action inside the Applications empty state. The surviving rule is one
  # create FLOW under one label, which an empty pane may repeat, not one create
  # BUTTON. The clause above now says that, and both pages behave that way:
  # Agents repeats Register agent, Inventory repeats Add tool and Add source.

  # THE DISTINCTION SURVIVED THE LOSS OF THE FILL, which is the only thing
  # worth checking when a treatment changes. This rule used to read "drawn
  # solid" against "drawn quieter than solid", and the pair moved together
  # when solid orange left the section: the create action is now the house
  # header button and the quieter way out is ghost — the same weight the
  # section already gives its sample-data toggle at rest, and for the same
  # reason, since clearing a filter and showing samples both change what is on
  # screen rather than what the organization has.
  #
  # Restating the clause as "at the same weight as the page's create action"
  # rather than naming a variant is deliberate. That phrasing was already in
  # the old rule and it is what kept the pane and the header honest through
  # this change: an empty pane repeating the header's action must look like
  # the header's action, whatever the section decides that looks like next.
  @integration
  Scenario: An empty pane's action is weighted by what it does
    Given a pane with nothing to list, offering a way out in its empty state
    When that way out creates something of the organization's own
    Then it is drawn as the house header button, at the same weight as the page's create action
    And a way out that only changes what is shown, such as clearing a filter,
      is drawn ghost, quieter than the house header button
    And neither of them is solid
    # Weight is part of a state's voice, so it is declared beside that state's
    # words rather than at the call site, where the next state added is the one
    # that forgets it.

  # ===========================================================================
  # Sample mode
  # ===========================================================================

  @unit
  Scenario: An empty page waits for an explicit sample choice
    Given every read on the page has answered and none of them holds a row
    When the page renders
    Then the sample panels are off screen
    When the reader chooses to see sample data
    Then the sample panels are on screen
    And the banner says nothing on the page is real

  @unit
  Scenario: Sample panels step aside once the page has real figures
    Given a read on the page holds a row
    When the page renders
    Then the sample panels are off screen
    And the toggle still offers to show them

  @unit
  Scenario: An unanswered read shows no sample panels rather than flashing them
    Given at least one read has not answered yet
    When the page renders
    Then no sample panels are shown
    And none appear and disappear as the reads land

  @unit
  Scenario: The reader's own choice outlives the data underneath it
    Given a page with real figures on it
    When the reader turns the sample panels on
    Then they stay on
    And the toggle reads as pressed

  @unit
  Scenario: A page may reword the sample banner but not soften it
    Given a page states its own reason for its sample panels
    When the banner renders
    Then it carries that page's words
    And it is still the same standing status strip, not an alert

  # One answer for the whole section, not one per page. A reader who turns the
  # samples off is saying they want their own screens, and being asked again on
  # each of the six pages — then again on the way back — reads as the product
  # not listening. The default is always the organization's own data.
  # Samples replace every displayed dataset only after an explicit choice.

  @unit
  Scenario: One sample choice governs every governance page
    Given the reader turned the sample panels on for one page
    When they open a different governance page
    Then its sample panels are on as well

  @unit
  Scenario: Turning the samples off on one page turns them off everywhere
    Given the reader turned the sample panels off for one page
    When they open a governance page with nothing measured on it
    Then no sample panels are shown there either

  @unit
  Scenario: Every sample toggle on screen moves together
    Given two sample toggles are rendered at once
    When the reader presses one of them
    Then the other reads as pressed without waiting for a reload

  @unit
  Scenario: A remembered sample choice survives leaving the page and coming back
    Given the reader turned the sample panels on for a page
    When they leave that page and return within the same sitting
    Then the sample panels are still on

  @integration
  Scenario: The sample toggle sits top-right and the banner directly under the header
    Given sample mode is available on a governance page
    When the page renders
    Then the toggle is among the actions at the top right of the page header
    And the banner, when sample mode is on, is directly under the header and above the filter row

  # The rule this protects is "an invented figure is never unmarked", and the
  # first draft mistook the mark for the badge. On Costs, where every panel is
  # invented whenever sample mode is on, the page-wide banner already said so
  # and sixteen badges repeated it — so the badge carried no information there
  # and the page now stands them down. That is the rule being honoured, not
  # broken, which the wording below now says.
  #
  # The exemption is deliberately narrow: only a banner covering the WHOLE
  # screen earns it. A page showing measured and invented panels side by side
  # has no such banner, and there the badge is the only thing telling the two
  # apart, so it stays mandatory.
  #
  # Bound on Inventory, which is the one page that renders both kinds at once
  # and can therefore prove the second clause. Costs never could: a panel is
  # invented there only while sample mode is on, and sample mode is what
  # raises the banner, so measured and invented have never coexisted on that
  # screen for a single render. It was the only binder of a rule it could
  # half-prove at best.

  @integration
  Scenario: Every invented panel is marked, by a badge or by a banner above it
    Given sample mode is on
    When the page renders its panels
    Then each panel whose figures are invented carries the sample badge
    And no measured panel carries it
    And a panel may drop its badge only while a banner speaks for the whole screen

  @integration
  Scenario: A panel with nothing in it shows sample data instead of Not available
    Given sample mode is on
    And a panel whose read returned nothing
    When the page renders
    Then that panel shows sample figures under the sample badge
    And it does not read Not available

  @integration
  Scenario: No error alerts are rendered while sample mode is on
    Given sample mode is on
    And a read on the page failed
    When the page renders
    Then no error alert is shown
    And the page shows its sample figures instead

  # ===========================================================================
  # Time controls
  # ===========================================================================

  @unit
  Scenario: Time Interval offers Month, Quarter and Year and opens on Quarter
    Given a governance page with a Time Interval chip
    When the page opens
    Then the chip offers Month, Quarter and Year
    And Quarter is selected

  @unit
  Scenario: Time Frame offers four spans and opens on Last 12 months
    Given a governance page with a Time Frame chip
    When the page opens
    Then the chip offers Last 3 months, Last 12 months, Year to date and Last 2 years
    And Last 12 months is selected

  @unit
  Scenario: An interval coarser than the frame is disabled
    Given the Time Frame is Last 3 months
    When the reader opens the Time Interval chip
    Then Year is offered as disabled
    And Month is offered as available

  @unit
  Scenario: Narrowing the frame steps the interval down to the widest that fits
    Given the Time Interval is Year
    When the reader narrows the Time Frame to Last 3 months
    Then the interval becomes the widest one that still fits the frame

  @integration
  Scenario: Time Frame and Time Interval are chips in the same row as the other filters
    Given a governance page offering both time controls
    When the page renders
    Then both are chips in the filter row
    And Time Frame reads as how far back the page looks
    And Time Interval reads as how wide each bucket is

  # ===========================================================================
  # Colour on a card
  # ===========================================================================
  #
  # WHERE THE COLOURS COME FROM, so no page has to decide again.
  #
  # There are exactly two sources and they are not interchangeable.
  #
  # The brand accent is #ED8926, published as the semantic token
  # `orange.solid` in platform/app/src/pages/_app.tsx. It marks AFFORDANCES —
  # the active tab, the primary button, the thing the reader can press. On
  # these pages it is doubly spoken for, because the sample-data banner and
  # its toggle are the loudest orange on the screen. A data mark painted in
  # the brand accent would read as another control, and on a governance page
  # as something to do with sample mode.
  #
  # The chart palette is the eight hues in
  # platform/app/src/utils/rotatingColors.ts (`PALETTE_HEX`, reached through
  # `getHexColorForString`), keyed so a name painting an avatar tint paints
  # the matching chart hue. Anything that carries a FIGURE draws from here.
  # A mark for a series named by the data takes the hue its name hashes to. A
  # single-series mark, which has no name to hash, takes `blue.solid`, so the
  # sparkline on a card and the area chart below it are visibly the same kind
  # of object.
  #
  # TWO BLUES, and this paragraph used to deny it. It said `blue.solid` was
  # "the same #3b82f6 the palette holds". Measured in the running browser, in
  # both themes: `blue.solid` is rgb(49,130,206), #3182ce, while `PALETTE_HEX`
  # lists #3b82f6 for blue. They are two different blues 1.28:1 apart, which is
  # the same colour to a reader and a different string to a grep.
  #
  # This is the same trap as the product's two oranges one section down, and it
  # is worth stating as a general fact about this app: THE SEMANTIC TOKENS AND
  # THE CHART PALETTE ARE TWO SEPARATE COLOUR SETS THAT SHARE THEIR NAMES.
  # `blue.solid` and `PALETTE_HEX.blue` are both "blue" and neither is the
  # other. A rule written over colour NAMES cannot see the difference; only a
  # resolved value can. So a claim in this file that two colours are equal is
  # not a thing to reason out from the source — it has to be measured, and if
  # it has not been measured it should not be written.
  #
  # THE MISTAKE THIS RULE EXISTS TO STOP, because it was made here first: a
  # governance card wanted a mark that would not shout, and reached for
  # `fg.muted` to get it. That is a TEXT token. At light theme it resolves
  # near black, so the sparklines and the seat bars came out as black marks on
  # grey — a monochrome dashboard sitting inside a product that has a colour.
  # Reaching for `fg.*` to quieten a data mark is the specific move to avoid.
  #
  # HOW TO BE QUIET AND IN PALETTE AT ONCE. Loudness is controlled by WEIGHT,
  # never by hue. The mark takes its palette colour at full saturation and is
  # kept in its place by being thin and by carrying a fill that fades to
  # nothing — a 1.5px stroke over a vanishing fill reads as a footnote to the
  # figure above it, which is what a sparkline on a card is. Draining the
  # colour instead buys restraint we can already have for free, and pays for
  # it by leaving the screen looking like it belongs to no product.
  #
  # The smallest chart on a screen must not be the loudest thing on it. A card
  # already states its figure in large type; the mark under it answers "which
  # way has this been going", and a mark that outshouts the number it explains
  # has inverted the card.
  #
  # A CARD'S MARKS DO NOT GO RED OR GREEN. A trend mark reports what an
  # organization did — spend rising, seats filling, conversations growing —
  # and none of those is a success or a failure on its face. Colouring a
  # direction good or bad has the screen passing judgement on a programme it
  # cannot see the goals of. Direction is carried by sign and by shape.
  #
  # This governs MARKS, and the first draft of it said "nothing here", which
  # was too wide and collided with two rules that were already settled. A
  # severity badge is a judgement and is supposed to look like one:
  # specs/ai-governance/dashboard/governance-overview-hero.feature, "each row
  # leads with a severity badge in the palette that severity carries". And a
  # trend CELL in a table is ruled on separately, and differently, by
  # specs/ai-gateway/governance/birds-eye-dashboard-v2.feature, "Trend cell
  # only colors orange when actually anomalous", which requires orange past a
  # documented threshold. Both stand. The line between them is that a badge
  # and a threshold-crossing cell state a verdict someone configured, where a
  # sparkline states a shape.
  #
  # This rule was twice excused as unbindable, and both excuses were wrong.
  # The first said the colours land in generated class names jsdom cannot
  # resolve, which describes a difficulty a RENDER assertion has, while the
  # instrument here is a source scan holding the value. The second said a scan
  # cannot tell a mark's red from a badge's red — true across a whole tree,
  # where the two live in the same directory, and irrelevant to a constant
  # named CHART_SPARK_STROKE, which is a mark and nothing else.
  #
  # So it is bound where it can be honestly bound: over the named chart
  # constants, which are marks by definition. It is NOT scanned tree-wide, for
  # the badge reason above, and that gap is real rather than papered over.
  #
  # This was worth the correction because green was reachable. Green is one of
  # the eight palette hues, so a green sparkline passed the palette rule, the
  # accent rule and the ink scan all three, and the only thing standing
  # between it and the screen was that nobody had written it.

  @unit
  Scenario: A card's mark is not painted in a direction colour
    Given the named marks the shared chart theme hands out
    When the colour each is drawn with is read
    Then none of them is the colour a screen uses for good
    And none of them is the colour a screen uses for bad
  #
  # THE INK FAMILY, which is the mistake that actually shipped. `fg` and
  # `fg-muted` are built to sit at READING contrast against the page — the one
  # thing a mark drawn through a chart must not do. The pull toward them is
  # real, because a quiet mark is what was wanted and the muted text token is
  # the nearest thing to hand with "muted" in its name. It is the wrong axis
  # of muted: dimmed ink, not a low-emphasis colour. The third scenario below
  # is scanned across every governance component rather than asserted on one,
  # because the failure it catches arrives in a file that does not exist yet.

  @unit
  Scenario: A single-series mark on a governance card is drawn from the chart palette
    Given the shared chart theme the governance cards draw from
    When a sparkline asks it for a colour
    Then it answers a hue the chart palette holds
    # This scenario carried "and never a foreground or text token" as a second
    # clause, which is the third scenario below said in different words, six
    # lines apart, in the file the cleanup designated as the rule's one home.
    # Dropped rather than reworded: the ink rule is scanned across every
    # component, and stating a weaker copy of it here gave two places to
    # change and one of them to forget.

  @unit
  Scenario: A data mark does not borrow the brand accent reserved for controls
    Given the shared chart theme the governance cards draw from
    When a sparkline asks it for a colour
    Then it is not the accent the pressable controls are painted in

  @unit
  Scenario: A chart's marks are drawn in chart colours, never in text colours
    Given any mark a governance chart draws to carry a figure
    When the colour it is drawn with is read
    Then it is a chart colour or a series colour
    And it is not the token the page draws its text with
    # Named for the family rather than a hex value on purpose. Pinning the
    # exact colour would make every retheme a test failure and teach the next
    # author to update the number, which is how a rule becomes a rubber stamp.
    # What must not drift is which family the mark draws from.

  # ---------------------------------------------------------------------------
  # ONE HUE, ONE MEANING, WITHIN A VIEWPORT
  #
  # The rules above each govern ONE mark: is it in palette, is it the accent,
  # is it ink. A mark can satisfy all three and still be wrong, because colour
  # on a dashboard does not mean anything on its own — it means "the same as
  # the other thing this colour". Three marks can each be correct and the
  # screen still be unreadable.
  #
  # Measured on the Costs screen, sample data on, one viewport, three blues:
  #
  #   #3182ce   `blue.solid`, the lane sparklines and the seat meter
  #   #2563eb   the "Seats assigned" bars, a hand-picked literal
  #   #3b82f6   `PALETTE_HEX.blue`, whichever agent's name hashed to blue
  #
  # 1.09:1 and 1.28:1 between the pairs, which is not a distinction a reader
  # makes. So blue said "lane spend" and "seats assigned" and "this one agent"
  # at once, and a reader matching the sparkline to the bars beneath it was
  # being told a relationship that does not exist.
  #
  # Note how each got there honestly. The sparkline took the reserved
  # single-series blue, which is the rule. The seat series was picked by hand
  # to sit apart from its slate partner, and does. The agent hashed to blue,
  # which is the rule too. Nothing here was a mistake in the small; the defect
  # only exists at the size of a screen, which is why it needs its own rule
  # rather than a stricter version of the three above.
  #
  # THE RULE. A page has a budget of meanings, not a budget of colours. Before
  # giving a mark a hue, name what the hue will mean to someone who sees it
  # next to everything else on the page. If that meaning is already spoken
  # for, the mark takes a different family — not a different shade of the same
  # family, which is what #2563eb next to #3182ce was.
  #
  # WHAT WAS DONE, so the next author does not undo it. The seats marks moved
  # off blue and onto `teal.solid`, chosen because teal and cyan were the only
  # two of the eight palette hues not already carrying a figure on that screen,
  # and cyan is the nearer to blue. Both seat marks moved together — the bar
  # chart's series and the per-pool meter inside the lane card — because they
  # are the same subject and had been drifting apart in two different blues.
  #
  # WHAT IS NOT SOLVED, and is written down rather than left to be rediscovered.
  # The single-series hue is drawn from the same eight hues the categorical
  # rotation hashes over, so an agent whose name lands on blue collides with it
  # again. This is arithmetic, not an oversight: a reserved hue taken from the
  # set it is reserved against will always be reachable. There is no fix that
  # does not give something up — excluding blue from the rotation on these
  # pages breaks the lockstep that makes an agent's chart segment match its
  # avatar tint elsewhere, and reserving a hue from outside the eight puts the
  # single-series mark out of palette. That trade belongs to whoever owns the
  # palette, not to this page. The scenario below therefore governs the marks
  # this page NAMES, which are the ones it can hold still.

  @unit
  Scenario: Two marks that mean different things do not share a colour family
    Given the named colours the governance cards draw their marks in
    When the family each one belongs to is read
    Then no two marks carrying different meanings share a family

  # ---------------------------------------------------------------------------
  # A METER IS NOT A TREND MARK
  #
  # Written down because the two rules looked like they collided and did not,
  # and an assumed boundary is one somebody re-argues every time.
  #
  # `~/components/ui/MeterBar` is the shared primitive for one value against
  # the width it is measured in. Its three existing consumers — a latency
  # column, a virtual key's budget bar, a derived-card view — all pass a fill
  # colour that changes with the reading: green under, orange near, red over.
  # The seat pool meter on the Costs card uses the same primitive and does not.
  # That looks like an inconsistency and is not one.
  #
  # A budget bar has a LIMIT. Somebody typed the number the bar is measured
  # against, and crossing it is an event they asked to be told about, so the
  # colour states a verdict its reader configured. That is the same licence the
  # severity badge and the threshold-crossing trend cell hold, cross-referenced
  # in the red-and-green block above.
  #
  # A seat pool has no limit. Seats bought is a contract, not a threshold, and
  # nobody has said what fraction idle is too many. Painting a mostly-idle pool
  # red would invent a verdict nobody set, on a number whose right value
  # depends on things the screen cannot see — a team mid-onboarding and a team
  # that stopped using the tool make the same bar.
  #
  # So the meter carries its level the way a meter does, in LENGTH. A pool with
  # one seat used in ten is a tenth of a track; a pool with nine in ten is nine
  # tenths. That reading is available at a glance, it is available to a reader
  # who cannot separate red from green, and it states the level without
  # grading it. The fill's colour is then free to do the only other job a
  # colour has here, which is to say WHAT the meter is about: seats, in the
  # same hue as the seat bars in the panel above it.
  #
  # The claim this rule was written against was that a flat fill "encodes no
  # state", so a pool 90 percent idle looks identical to one 5 percent idle.
  # It does not: those are a 10 percent bar and a 95 percent bar. The state was
  # always encoded, in the dimension a meter encodes things in.

  @unit
  Scenario: A meter states its level by length rather than by a colour that grades it
    Given one seat pool nearly all idle and one nearly all assigned
    When both meters are drawn
    Then the two fills differ in length
    And the two fills are drawn in the same colour

  @integration @regression
  Scenario: Sample mode replaces real cost figures and restores them when disabled
    Given Costs has real billed spend and active users
    When the reader enables sample data
    Then every cost panel shows sample figures instead of real figures
    When the reader disables sample data
    Then the real figures return

  @integration @regression
  Scenario: Sample sources replace real sources without offering real actions
    Given Inventory has connected sources
    When the reader enables sample data and opens Sources
    Then only sample sources and their counts are shown
    And sample sources offer no detail links or mutation actions
    When the reader disables sample data
    Then the connected sources return
