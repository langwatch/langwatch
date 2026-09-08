@governance @cost
Feature: One cost screen, three honest lanes
  The screen shows what the provider billed, what the gateway metered,
  and the seats a tenant holds — side by side, each labeled for what it
  is, never summed into one figure. The seat lane shows COUNTS, not
  money: how many seats are bought and how many somebody is sitting in.
  What those seats cost is already on the invoice the billed lane
  reports, so a price on the seat lane would put the same spend on the
  screen twice; the dated price list stays out. Until a licence list has
  been read, the seat lane renders as an honest empty state — labeled,
  visibly awaiting data, never a fabricated zero. A licence read that
  fails says that instead: "not read yet" and "could not be read" are
  different sentences, and only the seat lane degrades on one, while the
  money lanes carry on. LangWatch's own
  subscription seats are a different product concept and must never be
  shown in this lane. The screen is visible only to organization members
  with the governance cost permission, and stays behind release flags
  until it is ready.
  Decision: ADR-128.

  Background:
    Given an organization with billed and gateway cost available

  @integration
  Scenario: The department filter explains that it changes only the department breakdown
    Given cost activity in two departments
    And the viewer holds both governanceCost:view and activityMonitor:view
    When a permitted viewer selects one department on the cost screen
    Then the filter says it applies only to the department breakdown
    And that breakdown shows only the selected department
    And the billed total, gateway total and cost-by-user panel stay unchanged

  # =========================================================================
  # The time controls, and the one axis every chart on the screen shares.
  #
  # Governance is read at a governance cadence. Budgets are set by quarter
  # and headcount by year, so the screen opens on the last twelve months
  # bucketed by quarter, and the finest bucket it offers is a month. The
  # options themselves are the section-wide pair in
  # ~/components/governance/filters and their behaviour is specified in
  # specs/ai-governance/dashboard/governance-ui-controls.feature; what
  # follows is what THIS screen has to do with them.
  #
  # The reads underneath answer in days and take no bucket parameter at
  # all, so the fold to months, quarters and years happens on the client.
  # That is a deliberate choice not to widen a server contract for a
  # display concern — and it is also why the frame is clamped: every
  # governance cost input caps its window at 365 days, and the Time Frame
  # chip offers two years because every governance page offers the same
  # four spans. Serving twelve months under a two-year label without
  # saying so is exactly the class of quiet wrongness this screen exists
  # to refuse, so the shortfall is stated on the screen.
  #
  # Group By is gone. It named the series of one chart while sitting in a
  # row that reads as filtering the page, and every panel beside it
  # ignored it — so the one thing it reliably taught a reader was that a
  # chip on this page may or may not do anything. That chart says "by
  # team" in its own title now, where someone looking at it will see it.
  #
  # The bucket is stated once, in words, under the filter row. It used to
  # live in the heading of a full-width billed-against-metered chart that
  # sat between the lanes and the breakdowns. That chart is gone — it was
  # the largest thing on a screen that already carried four time series,
  # and the comparison it drew is the one the two lane figures above it
  # make directly. Its heading was also the only place the interval was
  # ever written down, which meant a rule about EVERY chart was being
  # proved against ONE. A sentence under the chips speaks for all of them.
  # =========================================================================

  @integration
  Scenario: The screen opens on the last twelve months bucketed by quarter
    When a permitted viewer opens the cost screen
    Then the Time Frame chip reads Last 12 months
    And the Time Interval chip reads Quarter
    And no Group By chip is on the screen

  @integration
  Scenario: Every chart on the screen is ticked by the interval in view
    Given the Time Interval is Quarter
    When a permitted viewer reads the cost charts
    Then no chart draws a bucket narrower than a quarter
    And the time axis reads the same way on every chart that has one
    And the screen says once, in words, which bucket the charts are drawn in

  # =========================================================================
  # A panel named "forecast" has to draw one. The marker that separates
  # served spend from the run-rate carried forward is placed on a day, and
  # the buckets under it are folded to whatever interval is in view, so the
  # two are only comparable once the marker is folded the same way. It was
  # not: it was dropped at anything wider than a month, which is every view
  # but one and NOT the default. The panel drew an unbroken area and the
  # projected tail read as money already spent.
  #
  # Rounding down is deliberate. The bucket holding the split is part
  # served and part projected, and it goes on the projected side, so the
  # screen understates what it knows rather than overstating what was
  # spent. Only one of those two errors invents money.
  # =========================================================================

  @unit
  Scenario: The projection marker survives the fold to any interval
    Given a sample forecast split partway through its window
    When its buckets are folded to the interval in view
    Then the marker names a bucket the chart draws
    And the bucket holding the split counts as projected, not as served

  # =========================================================================
  # And then a second thing was wrong with the same panel, which the marker
  # fix made visible rather than caused: the projection pointed BACKWARDS.
  # The generator shaded the last quarter of the window itself, so every
  # month the panel called projected had already happened. A forecast that
  # forecasts nothing is worse than no forecast, because the reader plans
  # against it.
  #
  # The projected months now come after the window's last day, and they are
  # a run rate carried forward rather than another roll of the generator.
  # Measured spend is noisy because serving traffic is noisy; a projection is
  # an average with an assumption on it, and drawing the tail with the same
  # jitter would claim we can predict next month's wobble.
  #
  # Money nobody has spent is not spend: the ranked panels total the measured
  # months alone, or "Cost by agent" would rank agents partly on a forecast.
  # =========================================================================

  @unit
  Scenario: The forecast projects months the window does not contain
    Given a sample forecast over a window of measured months
    When the projected months are read
    Then every one of them falls after the window's last month
    And the marker names the first of them

  @unit
  Scenario: A projected month is a run rate, not another roll of the dice
    Given a sample forecast whose measured months vary as real traffic does
    When the projected months are read
    Then they move less from month to month than the measured ones do

  # How the two regions are TOLD APART is deliberately not a scenario here.
  # Recharts draws nothing under jsdom — no SVG, no defs, no axis — so a test
  # claiming to check that the projected span is filled differently would
  # assert on markup that never exists, and pass forever whatever the chart
  # did. The drawing is checked by looking at it. What is pinned above is the
  # part a test can actually see: which months are projected, and that they
  # behave like a projection.

  @integration
  Scenario: A frame longer than the reads answer says how far the figures reach
    Given the reader picks a Time Frame of two years
    And the cost reads answer at most a year
    When the screen renders
    Then it says the figures cover the last twelve months
    And it does not label a year of figures as two

  @unit
  Scenario: Seat counts fold to the last period in the bucket, never the sum
    Given seat counts for three months inside one quarter
    When they are folded to that quarter
    Then the quarter reports the last month's count
    # A seat count is a level, not a flow. Three months at 420 seats is a
    # quarter holding 420, never 1,260 — the fold that is right for money
    # is wrong for a count, so seats get their own.

  # =========================================================================
  # SAMPLE DATA THAT MODELS THE REAL SHAPE, which is the only reason to have
  # sample data at all. Seats were generated as a near-constant fraction of
  # one another — bought and assigned rising together, quarter after quarter
  # — and that is not how anybody buys licences. A contract is signed once,
  # the seats are paid for before a single person has been given one, and
  # assignment catches up over the following quarters.
  #
  # The gap between the two lines is the idle spend this lane exists to show.
  # Drawn as a constant ratio it reads as a fixed overhead nobody can do
  # anything about. Drawn truthfully it reads as a spike at renewal that the
  # organization works off, which is a thing an admin can act on and the
  # reason they opened the panel.
  # =========================================================================

  @unit
  Scenario: Seats bought step up at renewal and hold flat until the next one
    Given invented seat counts across a window spanning a renewal
    When the bought counts are read month by month
    Then they change only at the renewal month
    And they never fall

  @unit
  Scenario: Seats assigned climb from the floor after a renewal
    Given invented seat counts for the months following a renewal
    When the assigned counts are read month by month
    Then they start well below the seats bought and rise toward them
    And no month assigns more seats than were bought

  @unit
  Scenario: The seat lane and the seat chart report the same month alike
    Given the invented seat lane and the invented seat chart
    When both are asked for the last month in the window
    Then they report the same counts
    # Two invented figures for one thing, side by side and disagreeing, is
    # the incoherence the rest of the sample data was fixed for.

  @unit
  Scenario: A period containing a day with no figure holds no figure either
    Given a month whose days include one the read could not price
    When the lane series is folded to that month
    Then the month holds no figure for that lane
    # Summing only the days we do have draws a total lower than the period
    # cost with nothing on the chart saying so — the same lie the per-day
    # figure already refuses to tell (ADR-128 §21).

  @unit
  Scenario: A period containing a restated day is itself marked restated
    Given a quarter holding one day the provider restated
    When the lane series is folded to that quarter
    Then the quarter carries the restatement marker
    And it carries the most recent restatement date in the quarter

  # =========================================================================
  # Sample mode on this screen.
  #
  # The section-wide rule lives in the UI controls spec: real data by default,
  # samples replacing every dataset only after an explicit choice.
  #
  # First, sample mode suppresses FAILURE, not just emptiness. A reader
  # who has asked to see what a filled-in Costs page looks like is not
  # answered by a red alert across the top of it, and "could not be
  # loaded" is just another way of saying the screen has nothing on it.
  # Every real alert comes back the moment the toggle goes off, and the
  # toggle is always on screen.
  #
  # Second, no panel on this screen may say only "Not available." That
  # sentence names neither the panel nor what would fill it, so a reader's
  # next move on seeing it is to report a bug against a screen working
  # exactly as designed. Every empty panel says what appears in it and
  # what has to happen for it to hold figures, and offers the move that
  # would do it where one exists.
  # =========================================================================

  @integration
  Scenario: No error alert is rendered while sample mode is on
    Given the cost read failed
    When sample mode is on
    Then no error alert is on the screen
    And the lanes show invented figures under the sample banner

  # The rule below used to read "each invented panel carries the badge", full
  # stop, and on a screen where every panel is invented that meant the amber
  # banner said nothing here is real and then sixteen grey badges said it again.
  # Sixteen repetitions do not make a point sixteen times; they turn the mark
  # into furniture, and furniture is what a reader stops seeing.
  #
  # So the mark is now suppressed by the banner and by nothing else. What must
  # never happen is an invented figure with nothing at all saying so, and the
  # scenario below is written to fail if the suppression ever widens past the
  # one case where something louder is already speaking for the whole screen.

  @integration
  Scenario: The screen says figures are invented once, not once per panel
    Given sample mode is on with nothing measured
    When the screen renders
    Then the banner says nothing on the screen is real
    And no panel repeats it with a badge

  # On this screen a panel is only ever invented while sample mode is on, so
  # the banner is up wherever a badge would have been and the suppression above
  # accounts for every one of them. The guarantee is asserted on the mark itself
  # rather than through the page, because the page cannot currently reach the
  # state that would prove it — and a scenario driven through a state the screen
  # cannot produce is not evidence of anything.

  @unit
  Scenario: The sample mark returns wherever no banner speaks for it
    Given an invented panel with no sample banner above it
    When the mark renders
    Then it shows, because nothing else on the screen says the figures are invented

  @integration
  Scenario: An empty panel says what it holds and what would fill it
    Given the activity reads answered with nothing and sample mode is off
    When the screen renders
    Then each empty panel names what appears in it
    And names what has to happen for it to hold figures
    And no panel reads only Not available

  @integration
  Scenario: The adoption panel shows sample figures rather than nothing
    Given no adoption has been measured
    When sample mode is on
    Then the adoption panel shows invented adoption figures under the sample banner

  @integration
  Scenario: The department chip offers sample departments while sample mode is on
    Given sample mode is on
    When the reader opens the department chip
    Then it offers the sample departments
    And picking one narrows the invented department breakdown to it

  # =========================================================================
  # EMPTY IS A COUNT OF FIGURES, NOT A COUNT OF DAYS. The over-time read
  # answers a row per day whether or not anything was spent, so a window with
  # nothing in it comes back as three hundred and sixty-five buckets of
  # nothing. Every emptiness test on this screen is a length check, and that
  # read alone therefore looked full while its neighbours looked empty: with
  # sample mode on, one panel sat saying "Nothing in this window yet" in the
  # middle of a screen of invented figures, because a list of 365 empty days
  # is not an empty list.
  #
  # The ranked panels never had it — they total their series first, and a
  # total of nothing is genuinely nothing.
  # =========================================================================

  @integration
  Scenario: A window of empty days fills with sample figures like every panel beside it
    Given the over-time read answers a row per day with nothing spent on any of them
    When sample mode is on
    Then the cost-over-time panel holds invented figures
    And no panel on the screen reports the window as measured and empty

  # =========================================================================
  # A COUNT THAT CANNOT STATE ITS OWN ABSENCE. Every other figure on this
  # screen is nullable, so "we did not measure this" and "we measured nothing"
  # arrive as different values. The adoption headcount is not: the activity
  # summary types it as a plain number and answers a zero-filled record when
  # there is no governance project and when there is no cost store, so an
  # organization with nothing connected gets the same 0 as an organization
  # whose people simply did not use a tool.
  #
  # Read literally that 0 was printed, and the screen said "People using AI
  # tools / 0" directly beneath its own banner saying no cost had been
  # recorded — the page contradicting itself in two adjacent lines, and
  # claiming a measurement of an organization it had just said it could not
  # see.
  #
  # THE BLUNT FIX IS WRONG IN THE OTHER DIRECTION. Treating every 0 as
  # unmeasured would hide a true zero: an organization with a source connected
  # and a genuinely quiet quarter measured nothing, and that IS the finding an
  # admin came to read. Suppressing it denies a measurement we actually took,
  # which is the same lie pointing the other way.
  #
  # So the test is CONNECTEDNESS, never the count. Nothing connected means
  # nothing was measured, whatever number arrived. Something connected means
  # the number is a reading, including when the reading is zero.
  #
  # And connectedness is a question this screen had already answered: the lanes
  # ask whether the summary HOLDS FIGURES before deciding whether the screen is
  # blank. The adoption card asks the same question, through the same function,
  # rather than a second one of its own — an organization can have a cost store
  # and a governance project with nothing flowing through them, so a card that
  # asked only whether the summary was structurally available would call that
  # organization connected and print its zero.
  # =========================================================================

  @integration
  Scenario: An adoption count of zero from a connected source is shown as the measurement it is
    Given a source is connected and the activity read answers zero active people
    When sample mode is off
    Then the adoption panel shows a headcount of zero
    And it does not ask the reader to add a source they already have

  @integration
  Scenario: An adoption count of zero with nothing connected is not reported as a measurement
    Given no source is connected and the activity read answers zero active people
    When sample mode is off
    Then the adoption panel does not print a headcount
    And it names what would fill it instead

  # =========================================================================
  # What the invented charts are allowed to claim.
  #
  # A sample chart teaches a reader the shape of a screen they have not
  # filled in yet, so a sample that could not occur teaches them a shape
  # the product will never show. Two of them were doing exactly that.
  #
  # Subscriptions were drawn as daily dollars. Nobody is charged for a
  # subscription daily, and ADR-128 §6 says seat money is not something
  # this product holds at all — the counts are the durable fact and what
  # they cost is already on the invoice the billed lane reads. So seats
  # are drawn as counts, bought against assigned, which is §16's wave-1
  # idle-seat aggregate: "you pay for N seats, M are assigned". Per
  # licence pool, not per department: attributing a seat to a department
  # needs the per-person assignment facts §16 names as wave 2.
  #
  # The forecast was labelled "consumption". The lane above it is
  # labelled "Metered by gateway" and §2 calls that money metering
  # throughout, so the forecast says metered too — a screen that names
  # the same money two ways teaches a reader they are two things.
  #
  # A panel was named after one provider's product. It is one of eight
  # ingestion sources and no metric in the ADR or the product docs is
  # named for it, so the panel is named for what it counts.
  # =========================================================================

  @integration
  Scenario: Seats are drawn as counts against a seat axis, never as money
    Given sample mode is on
    When the seat chart renders
    Then it plots seats bought against seats assigned
    And its figures are counts, with no currency anywhere on it
    And the two series are drawn side by side rather than added together

  @integration
  Scenario: No panel is named after a single provider's product
    Given sample mode is on
    When the screen renders its panels
    Then no panel title names one provider's product
    And the forecast is named for metered spend, the words the lane above it uses

  # A count of things and a measure of throughput are formatted apart. Both
  # axes used the abbreviating formatter, which put "4.6k" on the
  # conversations panel directly beside "3.4B" on the tokens one and made a
  # few thousand support chats look like a unit of machine consumption.
  # Conversations and seats are tallies — somebody could in principle count
  # them, and a reader comparing quarters wants the figure — so they are
  # spelled out. Tokens are throughput nobody holds in their head, where the
  # magnitude is the only part that matters.

  @unit
  Scenario: A count a person could tally is spelled out, never abbreviated
    Given a count of conversations and a count of tokens
    When each is formatted for its own axis
    Then the conversation count is written in full with its thousands separated
    And the token count is abbreviated

  @integration
  Scenario: Each lane renders its own labeled total
    Given billed and gateway totals that differ from each other
    When a permitted viewer opens the cost screen
    Then billed and gateway amounts appear as separately labeled figures
    And each lane shows the amount from its own lane's data, never the other lane's
    # The Given forces DISTINCT fixture values: with billed == gateway a
    # fully swapped implementation passes the cross-lane check. The test
    # must assert the two fixture values differ before asserting placement.
    # "Never summed into one figure" is a universal negative no test can
    # prove; ADR-128 assigns it to the code-review gate in wave 1.
    # "Matches its own source" end to end is a datastore-lane concern
    # covered by the rollup spec, not this component test.

  # =========================================================================
  # A LANE CARD ANSWERS ONE QUESTION AND RAISES ANOTHER. The money cards
  # showed a figure at the top, a sentence at the bottom, and a hand's width
  # of nothing between them, which a reader is owed an answer about. A total
  # on its own cannot say whether it is the end of a climb, a spike already
  # over, or a flat quarter — and that is the next thing anybody asks.
  #
  # So the space holds the lane's own window, drawn from the same series the
  # total above it was summed from. Never a second read: two figures for one
  # lane that could disagree is worse than a blank card.
  #
  # The change figure compares the LATER HALF of the window to the earlier
  # half, not the last period to the one before it. The series arrives per
  # day from a real read and per month from an invented one, so a last-point
  # comparison would mean a different thing on every screen it appeared on,
  # while measuring mostly the noise of a single day.
  #
  # It carries no colour. Spend rising is a fact about a window, not a fault,
  # and a red arrow would have this card judging an organization's AI
  # programme by whether it grew.
  # =========================================================================

  @unit
  Scenario: A lane card says which way its window is running
    Given a lane series whose later half spends more than its earlier half
    When the card's change figure is read
    Then it reports the rise as a percentage of the earlier half

  @unit
  Scenario: A window too short to compare halves reports no change at all
    Given a lane series of fewer periods than the comparison needs
    When the card's change figure is read
    Then there is none, rather than a figure drawn from too little

  @unit
  Scenario: A day whose figure is withheld is left out of the change, never counted as zero
    Given a lane series holding a day the read would not price
    When the card's change figure is read
    Then that day counts toward neither half
    # Same rule as everywhere else on this screen (ADR-128 §21): a withheld
    # amount is money not stated, and zero is money not spent.

  @unit
  Scenario: A lane sparkline is bucketed by the interval in view like every other chart
    Given a lane series read per day and an interval of Quarter
    When the sparkline's points are folded
    Then there is one point per quarter
    And a quarter holding only withheld days holds no point

  # Which COLOUR a mark on this screen is drawn in is not ruled here. It is a
  # section-wide rule, not a cost-screen one, and it lives in the UI rulebook
  # at specs/ai-governance/dashboard/governance-ui-controls.feature — see "A
  # single-series mark on a governance card is drawn from the chart palette"
  # and "A data mark does not borrow the brand accent reserved for controls".
  # This note exists because the rule was briefly written twice, once here and
  # once there, by two authors fixing the same black sparkline at the same
  # time. A style rule stated in two places is a style rule that will
  # eventually be stated two different ways.

  @integration
  Scenario: The seat lane is an honest hole until a licence list is read
    # The lane still renders so the screen's shape is complete, but it
    # must say it has no data — a silent zero here would be a lie about
    # money. LangWatch subscription seats (Subscription.maxMembers) are
    # NOT this lane's data and must not be wired in as a stand-in.
    Given the cost read returns no seat counts for this organization
    When a permitted viewer opens the cost screen
    Then the seat lane is present and labeled
    And the seat lane states that seat data is not yet available
    And the seat lane renders no digit characters
    # "No digit characters" is the named predicate, because "no rendered
    # money value" has no generic DOM check and each author would invent a
    # different one. It catches "$0.00", "0", "0,00 €" and zeros hiding in
    # accessible names (the assertion must read those too). Consequence:
    # the WAITING copy must stay digit-free — no "(0 sources)", no dates —
    # or the test breaks, and that break is the point. It binds the
    # waiting state only; the reported state below is all counts.

  @integration
  Scenario: The seat lane shows how many seats are bought and how many are assigned
    # Bought minus assigned is the whole money conversation — seats paid
    # for that nobody sits in — and neither number alone can say it, so
    # both are shown together on the pool they belong to.
    Given the tenant's licence list reports a pool with seats bought and some assigned
    When a permitted viewer opens the cost screen
    Then the seat lane names the pool and shows both counts
    And the seat lane shows no currency figure
    # The currency assertion is the point of the lane, not decoration:
    # the invoice the billed lane already shows is what the seats cost.
    # A price derived here from a unit count would be the same spend
    # reported twice, on one screen, under two labels.

  @unit
  Scenario: Only pools somebody is paying to seat people in reach the screen
    # Learned from a live tenant: the naive count said 27 unused seats
    # when the true answer was 2. A company-wide pool can never be
    # assigned to anyone and so reports zero assigned forever; a free
    # pool arrives with ten thousand units because the number caps how
    # far it may spread, not what anyone bought. Each is a loud,
    # plausible, wrong finding that buries the real one.
    Given a licence list holding a paid agent pool beside company-wide, free, suspended and non-agent pools
    When the cost summary is read
    Then only the paid agent pool appears on the seat lane
    # The uncounted pools are not lost — the licence read keeps every
    # pool it saw with the facts that classify it, so a later question
    # can still ask about them.

  @unit
  Scenario: A licence list with nothing countable in it reads as awaiting
    Given a licence list whose only pool is free
    When the cost summary is read
    Then the seat lane says it is awaiting data
    # Rather than reporting an empty list of pools. "We have read no
    # licences for you" and "your licences hold no seats" are different
    # sentences, and a screen that showed a count of zero pools would be
    # making a claim about a list nobody could count.

  @unit
  Scenario: A seat read that fails degrades only the seat lane
    # Three different sentences, and the lane could only say two of them:
    # "we have read no licences for you", "your licences hold no seats",
    # and "we tried to read them and could not". The third used to fail
    # the whole summary, so a licence read that broke took the billed and
    # gateway lanes down with it — honest, and out of proportion to what
    # actually broke.
    Given the licence read fails while the cost lanes answer normally
    When the cost summary is read
    Then the seat lane says the read failed
    And the billed and gateway lanes still carry their own figures
    And the failure is logged, because a lane that quietly says "could
      not be read" forever is a lane nobody is fixing
    # Only the seat read degrades. A cost rollup that fails still fails
    # the whole summary — the screen is about money, and a money lane
    # that swallowed its own failure is the defect this feature exists
    # to prevent.

  @integration
  Scenario: A failed seat read reads differently from one not yet taken
    Given the cost read reports that seat data could not be read
    When a permitted viewer opens the cost screen
    Then the seat lane says seat data could not be read
    And it does not say seat data is not yet available
    And the seat lane renders no digit characters
    And the billed and gateway lanes render their amounts as usual
    # Same digit-free rule as the waiting state, for the same reason: any
    # number in this lane is a number about money nobody measured.

  @integration
  Scenario: Viewing requires the organization-scoped governance cost permission
    Given a member without the governance cost permission on this organization
    # The permission is ORG-scoped (registry key governanceCost:view —
    # camelCase; underscore form is not a legal registry key). It must be
    # appended to BOTH built-in ORG_ADMIN bags (packages/authz roles.ts
    # and the rbac.ts mirror) or no real user holds it and today's org
    # admins lose the screen.
    When they request the cost data
    Then the request is denied

  @integration
  Scenario: A grant on another organization does not open this organization's costs
    # Client-side hooks resolve permissions against the active org only,
    # so this cross-org denial is a SERVER-side test on the cost query,
    # not a component test.
    # The actor MUST be a member of THIS organization: a non-member is
    # refused by the membership check alone, so that configuration passes
    # even against a resolver that ignores grant scope entirely — the
    # exact failure this scenario exists to catch.
    Given a member of this organization without the governance cost permission here
    And that member holds the governance cost permission on a different organization
    When they query this organization's cost data
    Then the query is refused

  @integration
  Scenario: The screen stays behind its release flag
    # ADR-128 names two flags: pulled-cost recording and the cost screen.
    # This scenario covers the screen flag; recording may be on while the
    # screen stays hidden. The actor HOLDS the permission — otherwise the
    # permission guard denies anyway and the test passes with the flag on,
    # proving nothing about the flag. Second vacuity trap: the flag guard
    # renders not-found whenever no organization is resolved, regardless
    # of the flag — the test must establish a RESOLVED organization or it
    # passes with the flag on for the wrong reason.
    Given the cost screen release flag is off for the organization
    And a viewer holding the governance cost permission
    And the viewer's organization is resolved
    When they open the place the screen would live
    Then the not-found screen is shown in its place

  @integration
  Scenario: A failed cost read never renders as zero
    # The exact failure the feature forbids: a `?? 0` on a failed or null
    # read fabricates a zero where there is no data. An error is honest;
    # a zero is a statement about money. The read fails even though the
    # data exists (Background) — an outage, not an empty account.
    Given the cost read request fails despite cost data existing
    When a permitted viewer opens the cost screen
    Then an error state is shown
    And no lane displays a zero amount

  @integration
  Scenario: A deployment without a cost store shows unavailable, not zero
    # The house degrade pattern (optional repository, empty-shape return —
    # see personalUsage.service.ts emptySummary) returns ZEROS when the
    # datastore is absent. For this screen that pattern is forbidden: a
    # deployment with no cost store must say the data is unavailable, not
    # report $0.00 of spend. The cost service's empty shape carries null
    # amounts, a deliberate deviation from that precedent.
    Given a deployment where the cost datastore is not configured
    When a permitted viewer opens the cost screen
    Then the screen states cost data is unavailable
    And no lane displays a zero amount

  @unit
  Scenario: A lane with usage we cannot state in US dollars holds no total
    # The partial-sum defect. When part of a lane has an amount we cannot
    # state in US dollars, adding up only the rest produces a smaller
    # number that still reads as the lane's whole figure — and nothing on
    # the screen says how much was left out. A lane we cannot total is a
    # lane with no total, and the screen would rather say nothing than
    # understate what an organization spent.
    Given one lane has usage billed in a currency other than US dollars
    And that same lane also has usage billed in US dollars
    When the cost screen reads that window
    Then that lane holds no total
    And the total of only its US dollar usage is not offered as the lane figure

  @integration
  Scenario: A lane with no total says why instead of showing a figure
    # The note is the whole reason withholding is acceptable rather than
    # broken. It must describe what actually happened: for the dominant
    # cause the provider DID state an amount, in another currency, and
    # nothing converts it — so copy claiming the amount is missing is
    # wrong, and a reader who checks against the provider invoice finds it
    # wrong.
    Given a lane whose total is withheld because some usage is billed in another currency
    When a permitted viewer opens the cost screen
    Then that lane shows no amount
    And that lane says some of its usage is billed in a currency other than US dollars
    And that lane names that currency

  @unit
  Scenario: A day mixing stated and unstated amounts holds no figure for that lane
    # The same rule for the chart. A day whose figure covers only part of
    # what was spent must be a gap in the line, because a point drawn at a
    # partial amount is a claim about that day nobody can stand behind —
    # and a gap is the one shape a reader cannot misread as a low-spend
    # day.
    Given a day where one lane has both US dollar usage and usage billed in another currency
    When the cost screen reads that window
    Then that lane holds no figure for that day
    And the other lane keeps its own figure for that day

  @integration
  Scenario: Rows written by an older summary shape are not counted
    # Every summary row carries the stamp of the shape that wrote it, and
    # the writer already refuses to read back a row carrying an older
    # stamp. The screen reads the same table and must apply the same rule:
    # without it a superseded row keeps contributing money to the total
    # forever, and no compaction ever removes it because a row under an
    # older stamp is not a replacement for the current one.
    Given the summary table holds a row for a day written by an older version of the summary
    And a row for the same day and lane written by the current version
    When the cost screen reads that day
    Then only the amount from the current version is counted

  @integration
  Scenario: A refund-heavy billed day renders negative as reported
    # Render-only in wave 1: the screen shows what the bill says, without
    # interpretation. (Deeper negative-day semantics are stamped wave 2 in
    # the ADR; flagged to the ADR owner as a deliberate scope call.)
    # ENFORCEMENT GAP: parity binds by title only, so a bare formatter
    # unit test would satisfy this scenario. No Gherkin wording closes
    # that; the per-rung review must verify the bound test renders the
    # screen. Reviewers: reject a binding that never mounts the lane.
    Given a billed day whose total is negative
    When a permitted viewer opens the cost screen
    Then the billed lane shows the negative amount as reported

  Rule: The screen says where its numbers stop being complete
    # ADR-128 4a. A source whose pulls keep failing brings nothing back, so it
    # reports no spend, so the lanes fall. On screen that is indistinguishable
    # from a cheap month, and a reader who takes a stalled pull for a saving is
    # worse off than one with no cost screen at all. The source pages already
    # carry this line; only someone already suspicious goes there.
    #
    # These scenarios say "failing to pull", not "stopped pulling", and the
    # difference is a known gap rather than pedantry. What is detected is a run
    # of consecutive pull FAILURES. A source whose worker is never scheduled at
    # all keeps a zero failure count and is never named here, though its
    # figures are exactly as incomplete. Closing that needs a staleness rule
    # measured against each source's expected pull interval, which nothing
    # records yet. Until it exists, this Rule covers the loud failure and not
    # the quiet one.
    #
    # "Every source" below means every source the organization has that is not
    # archived. The read does not distinguish sources that feed cost from
    # sources that do not, so a failing non-cost puller is named here too.
    # Deliberate: the alternative to a slightly wide caveat is silence, which
    # is the harm this Rule exists to stop.

    @integration
    Scenario: The cost screen says where its numbers stop being complete
      Given a source whose pulls have been failing
      When a permitted viewer opens the cost screen
      Then the screen names that source and the day of its last successful pull
      And the lanes are still shown
      # The figures are caveated, not withdrawn. What was pulled before the
      # failures is still the truth about those days.

    @integration
    Scenario: A screen whose sources are all pulling carries no warning
      Given every source pulling successfully
      When a permitted viewer opens the cost screen
      Then the screen carries no stopped-pulling warning
      # A caveat on whole figures teaches the reader to ignore caveats.

    @unit
    Scenario: The gap is dated from the first source that started failing
      Given two sources whose pulls started failing on different days
      When the cost summary is read
      Then the gap is dated from the earlier of the two
      # The totals stopped being whole when the first one broke, not the last.

    @unit
    Scenario: A source nobody asked to run is not reported as having stopped
      Given a disabled source whose last runs failed before it was switched off
      When the cost summary is read
      Then it is not reported as having stopped pulling
      # A disabled source is not failing to run, it is doing what an admin
      # chose. Split from the never-pulled case below on purpose: they are two
      # independent exclusions, and one regressing must not hide behind the
      # other holding.

    @unit
    Scenario: A source that has never pulled has no day to report
      Given a source that has never pulled successfully
      When the cost summary is read
      Then it is not reported as having stopped pulling
      # There is no "since" to name, and its awaiting-first-event badge
      # already says so.

  Rule: The seat lane reads the newest report of each pool, and nobody else's

    A licence count is a standing fact, not a running total. Each read of a
    tenant's licences writes another report of the same pools, so the store
    must hand back the newest report of each pool and nothing else — summing a
    pool's reports would multiply the tenant's seats by however many times the
    list happened to be read. These scenarios run against a real ClickHouse
    because that is the only place the answer is decided.

    @integration
    Scenario: A pool that was read on several days reports its newest day only
      Given a licence pool recorded on an earlier day and again on a later day
      When the tenant's seat reports are read
      Then the pool appears once, dated the later day
      And its counts are the ones the later day reported
      # The earlier day is still on the record and can still be asked about.
      # What it must never do is arrive beside the later one as a second pool.

    @integration
    Scenario: A day read twice answers the same before and after a compaction
      Given a day recorded once and then recorded again with different counts
      When the tenant's seat reports are read before and after the store compacts
      Then both reads report the counts the second recording carried
      # The two recordings share one identity, so the store collapses them when
      # it compacts. A read that let the compaction decide the winner would
      # answer differently depending on when it happened to run, and nothing
      # about a licence count is supposed to depend on that.

    @integration
    Scenario: A read carries no pool belonging to another tenant or another kind of record
      Given another tenant holding a pool of the same name
      And this tenant holding records that are not licence reports
      When the tenant's seat reports are read
      Then only this tenants licence pools are returned

    @integration
    Scenario: A pool whose recorded payload cannot be read costs only that pool
      Given a tenant whose licence list holds one unreadable pool beside readable ones
      When the tenant's seat reports are read
      Then the readable pools are returned with their counts
      And the unreadable pool is absent rather than reported as zero seats
      # Zero is a number a summary would faithfully honour. Absent is the
      # honest answer for a pool nobody could read.

  Rule: Pulled spend says who spent it, in the words the identity screen uses

    # ADR-128 §14 / ADR-129. The rollup carries a spender id and an agent on
    # every pulled cell from the naming line (2026-10-01) forward; this Rule
    # is the read that puts them in front of a viewer. Until that line, and
    # for every provider that names nobody, the ids are EMPTY and the
    # not-named bucket below carries all of the money — the scenarios seed
    # named rows in fixtures, and the panel is honest that live data starts
    # at the line.
    #
    # A spender is (provider, spender id), never the id alone — that pair is
    # the discovered person's unique key, and an id string two providers both
    # use is two people. The label is the People screen's DISPLAY TEXT for
    # that person, because that screen labels its rows with the display text
    # always — a different word here (a member name, a prettified id) makes
    # one person read as two. A spender discovery has not seen is shown as
    # the id itself, which is all anybody knows.
    #
    # The breakdown reads the PULLED lane only. The gateway lane writes actor
    # ids into the same table under a different provider vocabulary; letting
    # them in would both mislabel and cross-sum the lanes the screen keeps
    # apart.

    @unit
    Scenario: Pulled spend is grouped by who spent it
      Given pulled cost recorded under two different spender ids at one provider
      When the spender breakdown is read
      Then each spender's rows total under their own spender and nobody else's

    @unit
    Scenario: Gateway rows never enter the spender breakdown
      # The rollup holds both lanes. An unfiltered read would satisfy every
      # other scenario here while quietly summing gateway money into a
      # spender's pulled total — the cross-lane sum this screen exists to
      # refuse.
      Given pulled cost and gateway cost recorded for the same day
      When the spender breakdown is read
      Then only the pulled rows are counted

    @unit
    Scenario: The same spender id at two providers stays two spenders
      Given pulled cost under one spender id string at two different providers
      When the spender breakdown is read
      Then the two providers' rows stay separate
      And each is labeled from its own provider's discovery

    @unit
    Scenario: A spender discovery has seen is labeled with the identity screen's display text
      Given pulled cost under a spender id that discovery has seen
      When the spender breakdown is read
      Then the row is labeled with that person's display text
      # The display text, NOT the linked member's name: the People screen
      # labels every row with the display text and shows the link beside it,
      # so a member name here would name the same person differently on two
      # screens. A spender discovery has not seen is labeled with the raw id
      # itself.

    @unit
    Scenario: Spend nobody is named for gathers under one honest bucket
      # OpenAI rows before the naming line and every provider that names
      # nobody write an EMPTY spender id. Those rows are real money and must
      # stay on the screen — under a label that says no one was named, never
      # under an invented person and never silently dropped.
      Given pulled cost whose rows carry no spender id
      When the spender breakdown is read
      Then that spend appears under a single not-named row
      And no spender name is invented for it

    @unit
    Scenario: An erased spender is shown by pseudonym
      # Erasure rewrites the rollup's spender id to the pseudonym and the
      # discovery row's id and display text to the same pseudonym, so the
      # breakdown matches and shows it. Pinned to that mechanism only: the
      # suppression snapshot's staleness window and the cross-provider
      # digest are known erasure gaps that live outside this read, and a
      # universal "the raw id can never appear" is not a promise this
      # breakdown can keep for them.
      Given pulled cost recorded under an erased person's pseudonym
      When the spender breakdown is read
      Then the row is labeled with the pseudonym

    @unit
    Scenario: A spender mixing priced and unpriced rows holds no figure
      # The same partial-sum rule as every lane total: a figure covering only
      # the priced part of a spender's rows understates them by an amount the
      # screen cannot disclose. No current puller can produce this row — the
      # only non-USD biller names nobody, and every naming puller is USD-only
      # — which is exactly why the rule is pinned now: the first puller that
      # does must not be able to understate anyone.
      Given one spender with rows priced in US dollars and rows holding no US dollar figure
      When the spender breakdown is read
      Then that spender's row holds no total
      And it says how many of its rows carry no figure

    @unit
    Scenario: Breakdown rows are spender-and-agent pairings
      # The agent is part of the cell's key, and one Genie user spends in
      # several spaces. So a spender appears once PER AGENT they spent
      # through, each pairing totaling its own rows; a provider that names
      # no agent leaves the pairing's agent empty and the row shows none —
      # never a blank pretending to be one.
      Given one spender whose pulled rows name two different agents
      And another spender whose rows name none
      When the spender breakdown is read
      Then the first spender appears once per agent with that agent's own total
      And the second spender's row carries no agent

    @integration
    Scenario: The cost screen shows who spent the pulled money
      Given pulled cost recorded under a spender id that discovery has seen
      When a viewer holding both the cost and the identity permissions opens the cost screen
      Then a spender panel lists that spender with their window total
      And the panel is labeled as billed spend, apart from the trace-cost cost-by-user panel
      # The screen already carries a "Metered spend by person" panel summing the cost
      # recorded on traces; the two measure different money and stay side
      # by side, each labeled — same lane discipline as the totals.
      # Rendered from the same gates as the lanes: no panel on an
      # unavailable screen, and the panel absent rather than zero-filled
      # when the breakdown holds no rows. A failed read is the exception:
      # that is an outage, not an empty account, so the panel says it
      # failed instead of vanishing as if nobody spent anything.

    @integration @regression
    Scenario: The provider-reported breakdown names users and keeps unattributed spend
      Given the provider-reported cost breakdown returns users and unnamed spend
      When a permitted viewer opens the cost screen
      Then the panel is titled "Provider-reported spend by user"
      And the unnamed row is labelled "Unattributed spend"
      And the panel does not claim to group by API key
      And metered spend stays in its own panel

    @integration
    Scenario: The spender breakdown stays behind the identity screen's permission
      # The labels are the People screen's data. A custom role holding only
      # the cost permission is refused that screen, and this breakdown must
      # not hand its content over anyway — the cost permission alone buys
      # figures, not names.
      Given a member holding the governance cost permission but not the identity screen's permission
      When they request the spender breakdown
      Then the request is refused
      And the cost lanes still answer for them

  Rule: The total shown is the bill; gateway detail splits it

    # Every scenario under this rule says what a reader is SHOWN, and nothing
    # shows it yet: there is no connected view, and no arithmetic behind it —
    # the caller-less `combineProviderDay` and its tests were removed as dead
    # code (#7923). So these stay parked rather than bound. They become @unit
    # the day a reader can see the numbers, and the day something says which
    # bill pays for which gateway key — that link is not recorded yet.

    @unimplemented
    Scenario: Gateway detail splits the bill and the remainder is its own line
      Given a bill of six dollars for a provider day
      And four dollars twenty of gateway spend on keys that bill covers
      When the connected view is drawn
      Then the total shown is six dollars
      And four dollars twenty is shown as attributed
      And one dollar eighty is shown as not seen by the gateway

    @unimplemented
    Scenario: Gateway spend above the bill is shown as a variance, never subtracted
      Given a bill of six dollars for a provider day
      And six dollars fifty of gateway spend on keys that bill covers
      When the connected view is drawn
      Then the total shown is still six dollars
      And fifty cents is shown as metering running over the bill
      And nothing is subtracted from the total

    @unimplemented
    Scenario: A refunded day stays negative
      Given a provider day whose bill is a refund
      When the connected view is drawn
      Then the total shown is negative
      # Clamping it to zero would silently eat money.

    @unimplemented
    Scenario: A day the bill has not reached yet is marked estimated
      Given a key covered by a bill
      And gateway spend on a day no bill has reported yet
      When the connected view is drawn
      Then the day shows the gateway figure marked as estimated

    @unimplemented
    Scenario: The estimate becomes the bill when the bill lands
      Given a day shown as estimated from gateway spend
      When the provider's bill for that day arrives
      Then the day shows the bill and is no longer marked estimated

    @unimplemented
    Scenario: Gateway spend no bill covers stands alone
      Given gateway spend on a key no bill covers
      When the connected view is drawn
      Then that spend is shown on its own as metered
      And it is not counted against any bill

    @unimplemented
    Scenario: A bill and its keys in different currencies are not combined
      Given a bill in euros covering keys metered in dollars
      And the provider published no dollar figure of its own
      When the connected view is drawn
      Then the bill and the gateway spend are shown separately in their own currencies
      And no split is shown for that day

    @unimplemented
    Scenario: The parts of a day always add up to its total
      Given any provider day with a bill
      When the connected view is drawn
      Then the attributed part and the part not seen by the gateway add up to the total exactly

  # A REFUSAL IS NOT A FAILURE.
  #
  # Reported from a first visit: an organization that had configured nothing
  # opened Costs and was met by red alerts saying something had gone wrong.
  # Nothing had. The plan gate and the permission check both answer before a
  # single cost row is read, so there was no outage to report — the screen was
  # working exactly as designed and blaming itself for it.
  #
  # Two things follow. The page names the real cause, using the live plan to
  # tell "your plan does not cover this" from "your role does not open this",
  # because the server's own wording is copy and cannot be relied on.
  # Samples remain an explicit choice for both refused and failed reads.

  Rule: A read the server declined is reported as a decline, not as a fault

    @integration
    Scenario: A declined read is never reported as something going wrong
      Given a reader whose cost read is declined by the plan gate
      When the cost screen is drawn
      Then no alert says the cost data could not be loaded
      And nothing on the screen says something went wrong

    @integration
    Scenario: A declined read offers samples without enabling them
      Given a reader whose cost read is declined by the plan gate
      When the cost screen is drawn
      Then the refusal is shown without invented figures
      And the control to show sample data is on the screen

    @integration
    Scenario: A declined read names the plan when the plan is what declined
      Given an organization below the Enterprise plan
      And a reader who has turned the invented panels off
      When the cost screen is drawn
      Then the screen says the cost views come with the Enterprise plan
      And it does not say something went wrong

    @integration
    Scenario: A declined read names the grant when the plan already covers it
      Given an organization on the Enterprise plan
      And a reader whose cost read is declined for want of a grant
      And a reader who has turned the invented panels off
      When the cost screen is drawn
      Then the screen says the reader does not have access to cost data
      And it does not name the plan

    @integration
    Scenario: The spender panel states what it holds when its read is declined
      Given a reader whose spender read is declined
      And a reader who has turned the invented panels off
      When the cost screen is drawn
      Then the billed-spend-by-person panel says what would fill it
      And it does not offer to try the read again
      # "Try again" is advice that cannot work against a decline.

  Rule: A read that genuinely broke still reports the failure

    @integration
    Scenario: A failed read still reports the failure
      Given a cost read that fails with a server fault
      When the cost screen is drawn
      Then the screen says the cost data could not be loaded
      And it does not say the read was declined

    @integration
    Scenario: A failed read does not turn sample mode on by itself
      Given a cost read that fails with a server fault
      When the cost screen is drawn
      Then the invented panels are not shown
      And the control to turn them on is on the screen
      # A fault is not evidence the screen is empty, so the page offers the
      # samples and leaves the choice with the reader.
