Feature: The controls every AI Governance page renders the same way
  As an admin who moves between Home, Costs, Inventory, Agents and People
  I want each page's filters, actions and sample data to look and behave alike
  So that a control I learned on one page is the same control on the next

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
  # CORRECTION, and the earlier text here caused real damage before it was
  # caught. This paragraph used to say the parity checker rejects an
  # `@scenario` written inside a multi-line JSDoc block, and that two tests
  # had been found green and unbound that way. BOTH CLAIMS WERE FALSE. The
  # checker's ANNOTATION_RE (platform/app/scripts/check-feature-parity.ts:1003)
  # begins `^[ \t]*(?:(?:\/\/|\/\*|\*|#)[ \t]*)*@scenario`, and that `\*` in
  # the alternation is exactly the continuation marker a multi-line block
  # uses. A multi-line JSDoc binds perfectly well; around twenty governance
  # annotations are written that way today. An agent read the old paragraph,
  # believed it, and rewrote a working binding to escape a rule that does not
  # exist. A spec that states a falsehood as settled fact is worse than one
  # that says nothing, because it is followed.
  #
  # What DOES break, silently, is a scenario TITLE that wraps across a
  # newline. The quoted group cannot cross one, so the bare-title branch
  # captures the first line including its opening quote and binds a phantom
  # that matches no scenario. Every scenario title in this file is therefore
  # kept on one line, and that is the real reason — not the comment style.
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

  @integration
  Scenario: Every filter and sort control sits in one row under the page header
    Given a governance page with filters and a sort control
    When the page renders
    Then all of them are in a single row directly under the page header
    And that row is left-aligned
    And no filter is rendered anywhere else on the page

  # "At most one is solid" is what this rule used to say, and it could not do
  # the job it was written for. Zero solid satisfies "at most one", so the rule
  # was green while the Agents page drew Register agent grey and the Inventory
  # page drew Add tool solid orange — the same slot, the same kind of action,
  # two different buttons, which is the drift the rulebook exists to stop. It
  # also said "the rest outline" while the bound test asserted the sample
  # toggle is ghost. Both are fixed below: the page's own create action is
  # solid, always, and the sample toggle is named for what it is.
  #
  # The "at rest" qualifier below is load-bearing, and it was missing on the
  # first attempt. The kit renders the toggle `active ? "subtle" : "ghost"`
  # (SampleDataControls.tsx:45), so a page whose samples are showing draws a
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
    And the action that creates the page's own thing is solid
    And every other action beside it is outline
    And the sample-data toggle is ghost at rest, because it changes what is shown rather than the org
    And the sample-data toggle is subtle while pressed, and never solid in either state

  # ===========================================================================
  # Sample mode
  # ===========================================================================

  @unit
  Scenario: Sample panels fill a page with nothing measured on it
    Given every read on the page has answered and none of them holds a row
    When the page renders
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
  # not listening. Only the reader's answer is shared: each page still decides
  # from its own reads what to show before they have given one.

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
