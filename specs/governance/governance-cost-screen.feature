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
  Scenario: A cost-only viewer sees provider costs inside the billed card
    Given OpenAI and Anthropic have recorded costs without named people
    And the viewer holds governanceCost:view without identity or activity access
    When the viewer opens Costs
    Then the billed card shows its combined total and a labeled bar for each provider
    And gateway costs are not included in those bars

  @integration
  Scenario: Provider totals use corrected rollup cells within the selected window
    Given multiple cost cells, corrections, and a refund for one provider
    And another provider has an unpriced cell
    When provider costs are read for the organization and selected window
    Then only the latest current-projection pulled cells in that window are counted
    And named and unnamed spending both contribute to their provider
    And the unpriced provider's amount is unavailable

  @integration
  Scenario: Missing provider prices are not displayed as zero
    Given a provider has no complete USD amount
    When the viewer opens Costs
    Then that provider is labeled with an unavailable USD amount
    And a recorded refund keeps its negative amount

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
    And each pool draws its own bought-against-assigned pair, never added across products

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
    # prove; ADR-128 assigns it to the code-review gate in wave 1. That gate
    # covers TOKENS as well as money from here on: the screen carries three
    # token figures over traffic that overlaps, and adding any two of them is
    # the same mistake in a different unit. What IS testable is the label —
    # see "Every token figure names the store it was counted in" below.
    # "Matches its own source" end to end is a datastore-lane concern:
    # the billed lane's is covered by the rollup spec, the metered lane's
    # by the ledger scenarios in the section directly below.

  # =========================================================================
  # THE METERED LANE READS THE GATEWAY'S OWN LEDGER.
  #
  # The metered lane used to read the same daily rollup the billed lane
  # reads. A fold wrote the gateway's cells there under the tenant of the
  # project whose traffic it was, while the screen read them under the
  # hidden governance project's tenant, so for real traffic the lane was
  # always empty and only fixtures ever filled it. Two writers on one table
  # is what made that possible, so the fold is gone rather than repaired:
  # the lane reads the gateway's per-request ledger directly, the rows the
  # fold already wrote stay where they are and no read counts them, and
  # every read of the rollup asks for pulled rows only. The nightly check
  # that compared the rollup against its sources checks the billed lane
  # alone now, and what happens to the gateway half's leftover scheduled
  # rows is specified beside the comparator in governance-cost-rollup.feature.
  #
  # A request is the unit. The ledger keeps one row per gateway request,
  # partitioned by the month it started in, and the same request can sit
  # in two months when its outcome landed before its admission and the
  # admission moved the start time. A sum that trusts the table to have
  # merged those rows counts that request twice. The day a request belongs
  # to is the day it STARTED, in UTC: a streamed answer running across
  # midnight is one request, on the day the caller asked.
  #
  # A failed request that consumed tokens is still priced, so it counts.
  # The lane groups by model and by virtual key only: the ledger sits
  # outside erasure, so a person's identifier read from it would outlive
  # a deletion the rest of the product honoured.
  #
  # Requests with no dollar amount are counted beside the total rather
  # than blanking it, unlike the billed lane's rule further down. There a
  # cell with no amount hides an unknown share of a bill; here the count
  # beside the figure names exactly what is left out — marked, not
  # withheld, the same choice the provider breakdown makes for a euro
  # bill. The ledger cannot tell a request nobody priced from a free one,
  # so both are "no dollar amount", and a request that settled with its
  # cost never confirmed is counted among them rather than left out.
  # =========================================================================

  @integration
  Scenario: The metered lane counts gateway spend from every project of the organization
    Given gateway requests recorded under two projects of the viewer's organization
    And gateway requests recorded under a project of another organization
    When a permitted viewer opens the cost screen
    Then the metered lane total is the sum of both of the organization's projects
    And the other organization's requests contribute nothing

  @integration
  Scenario: A failed request that consumed tokens still counts as metered spend
    Given a confirmed gateway request and a failed one priced for the tokens it consumed
    When the metered lane is read
    Then both requests' amounts are in the metered total

  @integration
  Scenario: A request written into two months is counted once
    Given a gateway request whose outcome was recorded before its admission
    And the admission moved its start time into the previous month
    When the metered lane is read
    Then that request's amount is in the total exactly once

  @integration
  Scenario: A stream crossing midnight belongs to the day it started
    Given a gateway request admitted ten minutes before midnight UTC whose answer finished after it
    When the metered day series is read
    Then the whole amount is on the day the request started
    And nothing is on the day it finished

  @integration
  Scenario: Metered spend is grouped by model and by virtual key, never by person
    Given gateway requests from two virtual keys against two models
    When the metered breakdowns are read
    Then each model's requests total under that model
    And each key's requests total under that key
    And the metered read offers model and virtual key as its only groupings

  @integration
  Scenario: Requests with no dollar amount are counted beside the metered total, not inside it
    Given priced gateway requests, requests that consumed tokens but carry no dollar amount, and a request whose cost was never confirmed
    When a permitted viewer opens the cost screen
    Then the metered lane shows the total of the priced requests
    And beside it says how many requests carry no dollar amount

  @integration
  Scenario: A window of only requests with no dollar amount still shows the metered lane
    Given a window whose every gateway request carries no dollar amount
    And nothing billed and no seats reported
    When a permitted viewer opens the cost screen
    Then the metered lane is shown with no dollar figure
    And beside it says how many requests carry no dollar amount
    And the screen does not say nothing was recorded

  @integration
  Scenario: A request priced at zero whose only tokens were audio carries no amount
    # The separately rated modalities are stored in their own columns, taken
    # out of the text counts. A speech or vision request priced at zero holds
    # nothing in the text columns, so a count that only reads those calls it a
    # request that consumed nothing and the day reports a measured zero where
    # the cost is in fact unknown.
    Given a charged gateway request priced at zero whose only tokens were audio
    When the metered lane is read
    Then that request is counted among the requests carrying no dollar amount
    And the day reports no priced request

  @unit
  Scenario: The unpriced count reads the same tokens the metered token figure counts
    Given the metered read's counts of requests carrying no dollar amount
    When the tokens each of them looks at are compared
    Then every token the metered figure counts is one the unpriced count looks for

  @integration
  Scenario: A failed gateway ledger read never renders the metered lane as zero
    # The ledger read failing while the rollup read succeeds still rejects
    # the whole summary, per the rule at the top of the service.
    Given the gateway ledger read fails despite gateway spend existing
    When a permitted viewer opens the cost screen
    Then the cost screen shows its error state
    And no lane displays a zero amount

  @integration
  Scenario: Gateway rows left in the rollup are counted nowhere
    Given gateway rows the retired fold wrote into the rollup
    And pulled rows for the same days
    When the billed total, the provider, model and spender breakdowns and the day series are read
    Then every figure counts the pulled rows only

  # The nightly rollup check and its leftover gateway rows are specified in
  # governance-cost-rollup.feature, beside the comparator.

  # =========================================================================
  # THE HIDDEN GOVERNANCE PROJECT SCOPES THE BILL, NOT THE ORGANIZATION.
  #
  # That project is minted the first time somebody connects a provider bill,
  # and nothing else mints it. So an organization serving real gateway
  # traffic and buying no provider bill has none — and the screen used to
  # answer its whole summary with "nothing has been recorded", including the
  # two answers that were never the governance project's to give: what the
  # gateway metered across the organization's own projects, and, through the
  # connectedness test the adoption card reads, how many of its people used
  # an AI tool.
  #
  # The reads that DO belong to that project stay empty. The billed lane,
  # the provider bars, the per-currency lines, the seat lane and the Azure
  # billing note are all keyed by its tenant, and answering any of them from
  # a wider scope would move a money figure as a side effect of fixing a
  # headcount.
  #
  # The screen does not gain a new word for this. An organization with no
  # governance project and no gateway traffic has nothing to show and is
  # told so by the same sentence as an organization whose window is simply
  # empty, because that is the same fact. What must never happen is the
  # other order: a figure stated under a banner saying nothing was recorded.
  # The two are decided by one test — whether any lane reported — so they
  # cannot disagree.
  # =========================================================================

  @unit
  Scenario: The metered lane answers for an organization that has connected no provider bill
    Given an organization whose gateway served priced requests
    And no hidden governance project has ever been minted for it
    When the cost summary is read
    Then the metered lane reports what those requests cost
    And the screen does not say nothing was recorded

  @unit
  Scenario: No read scoped to the hidden governance project is issued without one
    Given an organization whose gateway served priced requests
    And no hidden governance project has ever been minted for it
    When the cost summary is read
    Then the billed lane, the provider bars and the seat lane hold no figure
    And no read keyed by the governance tenant is issued at all

  @unit
  Scenario: An organization with neither a governance project nor gateway traffic reports nothing
    Given an organization with no hidden governance project and no gateway requests
    When the cost summary is read
    Then no lane reports anything
    And the screen's connectedness test reads it as nothing recorded

  @integration
  Scenario: A metered figure with nothing billed still counts the organization's people
    Given a summary whose metered lane reports and whose billed lane and seats hold nothing
    When a permitted viewer opens the cost screen
    Then the adoption panel shows the headcount
    And the screen does not say nothing was recorded

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
  # The halves are compared as AVERAGES, and on the series as read rather
  # than the one folded for the sparkline. Both are needed and neither is
  # enough: averages settle halves holding a different NUMBER of periods,
  # measuring before the fold settles halves covering a different LENGTH of
  # time. Read as totals off folded buckets, a year of unchanged daily spend
  # reported growth on every date the page could be opened.
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
  Scenario: An odd number of periods does not invent a rise out of the split
    Given a lane series of an odd number of periods that all cost the same
    When the card's change figure is read
    Then it reports level, not the rise the uneven split would produce
    # The halves are compared as AVERAGES for this reason. An odd count splits
    # unevenly, and compared as totals the larger half wins on nothing but
    # holding one more period — five identical periods reported a 50% rise.

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
    # The partial-sum defect. When part of a lane has spend we hold no
    # dollar figure for, adding up only the rest produces a smaller number
    # that still reads as the lane's whole figure — and nothing on the
    # screen says how much was left out. A lane we cannot total is a lane
    # with no total, and the screen would rather say nothing than
    # understate what an organization spent. The per-currency lines shown
    # beside it follow the same rule, one currency at a time. The billed
    # lane only: the metered lane marks instead of withholding, see the
    # ledger section above.
    Given the billed lane has spend we hold no dollar figure for
    And that same lane also has spend stated in US dollars
    When the cost screen reads that window
    Then that lane holds no dollar total
    And the sum of only the parts stated in US dollars is not offered as the lane figure

  # ── The same rule, one level down, where it currently stops ───────────────
  # The lane above withholds because a cell holds no amount in any currency.
  # A euro cell is not that: it holds an amount, in euros. So a provider
  # billed in dollars and euros on one day has a dollar figure covering part
  # of its bill, nothing marked missing beside it, and no way for a reader to
  # tell the remainder from the whole. The lane headline already names the
  # currencies it could not convert. The two panels a reader opens underneath
  # it do not, and a marked total sitting directly above an unmarked
  # breakdown of the same money is how a reader learns to distrust both.

  @integration
  Scenario: A provider billed in two currencies says which one its figure leaves out
    Given a provider billed in both dollars and euros on the same day
    And no dollar figure was published for the euro bill
    When a permitted viewer reads the providers behind that day
    Then that provider's figure is marked as leaving the euros out
    # Marked, not withheld. Dropping the figure hands the reader a blank the
    # chart beneath turns into a zero, on a panel carrying no note that the
    # height is short — an honest dollar bill silently flattened. The figure
    # stands and says what is not in it.

  @integration
  Scenario: The records behind a period are marked the same way
    Given a period whose records were billed in both dollars and euros
    And no dollar figure was published for the euro bill
    When a permitted viewer opens the records behind that period
    Then that record's figure is marked as leaving the euros out

  @integration
  Scenario: A lane with no total says why instead of showing a figure
    # The note is the whole reason withholding is acceptable rather than
    # broken, so it has to describe what actually happened. What the screen
    # knows is that part of the lane has no dollar figure, and that covers
    # two different causes: spend the provider billed in another currency,
    # and spend read on a day when cost recording was off. Copy naming
    # another currency as the cause states a false reason for the second of
    # them, and a reader who checks it against the provider invoice finds
    # it wrong.
    Given a lane whose dollar total is withheld because part of it has no dollar figure
    When a permitted viewer opens the cost screen
    Then that lane shows no dollar amount
    And that lane says we hold no dollar figure for part of what it covers

  @unit
  Scenario: A day mixing stated and unstated amounts holds no figure for that lane
    # The same rule for the chart. A day whose figure covers only part of
    # what was spent must be a gap in the line, because a point drawn at a
    # partial amount is a claim about that day nobody can stand behind —
    # and a gap is the one shape a reader cannot misread as a low-spend
    # day.
    Given a day where one lane holds both spend stated in US dollars and spend we hold no dollar figure for
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
  Scenario: A window whose spend never moved says level on both money lanes
    Given a year in which every day cost exactly the same
    When the cost lanes are shown
    Then the billed lane's change badge reads level
    And the metered lane's change badge reads level
    # Both money lanes named rather than "every lane", because the seat lane
    # carries counts and has no change badge to read — a Then that said every
    # lane would promise a third assertion that cannot exist.
    #
    # Mounted, not computed in isolation. The defect was never in the
    # percentage alone — it was in which series the screen handed it, and only
    # a rendered screen can tell those two apart.

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

  # =========================================================================
  # Bringing the screen up to date, and the two things a reader has to be
  # able to take apart: which day, and which currency.
  #
  # The figures on this screen go stale the moment a pull lands, and nothing
  # on the page ever said so or offered to look again. A reader who knew a
  # pull had just run had no way to see its money without reloading the
  # browser. Refreshing has to bring the collection state with it: a figure
  # brought up to date beside a warning that is not is a worse screen than
  # one where both are old together.
  # =========================================================================

  @integration
  Scenario: One control brings the figures and the collection state up to date together
    Given the screen has been open long enough for its figures to age
    When a permitted viewer asks the screen to refresh
    Then the lane figures, the spender breakdown, every other breakdown on the screen and the note about stalled collection are all read again
    And the control says it is working until they answer
    # ENFORCEMENT GAP: parity binds by title, so a test can satisfy this by
    # re-issuing one read and letting the rest happen to be fresh already.
    # The bound test has to name each read the screen issues and assert
    # every one of them was issued again — the set by name, never a count,
    # because a count breaks on the next read the screen legitimately gains.

  @integration
  Scenario: The header says when the figures were last read
    When a permitted viewer opens the cost screen
    Then the header says when its figures were last read
    And the time shown is when the answer arrived, not when the screen was opened
    # Nothing reads again on its own here, so without this a reader cannot
    # tell a screen opened a moment ago from one left open since the
    # morning, and the refresh control beside it has nothing to argue with.

  @integration
  Scenario: A panel that fails to refresh says so instead of emptying
    Given a permitted viewer has asked the screen to refresh
    When one of the reads fails
    Then that panel says it could not be brought up to date
    And it is not left looking as though there was nothing to show
    # Every panel on this screen renders an unanswered read and an absent
    # figure the same way, so a failed refresh lands as a blank beside
    # freshly filled neighbours and reads as no spend — the one confusion
    # the whole screen exists to prevent.

  @integration
  Scenario: A failed read is never shown as a read that has not happened yet
    Given a panel that has no read of its own and folds the cost summary
    And the read behind that summary failed
    When a permitted viewer opens the cost screen
    Then that panel says it could not be brought up to date
    And it does not invite the reader to wait for traffic that was already served
    # The two states this screen is most careful to keep apart meet here. A
    # failed read hands the panel nothing, and nothing is this screen's word
    # for "not measured yet" — so the panel told the reader to wait for
    # traffic the gateway had already served and the read had lost on the way,
    # while the money lanes one screen above said, correctly, that the read
    # had failed. The two answers were one line of props apart.
    # A read that failed on a REFRESH is the same finding from the other side:
    # the last good figures are still in hand, and drawing them unmarked
    # presents figures nobody could confirm as current.

  @integration
  Scenario: A period that could not be read offers a way to try again
    Given the records behind a provider's period are open for a permitted viewer
    And that read failed
    When they press the control the failure offers for trying again
    Then the records behind that period are read again
    # Pressed, not remounted. Closing the period and opening it afresh already
    # re-runs the read, so a claim that it is merely "read again" is satisfied
    # by accident. What is missing is something to press, in the place the
    # reader is looking when they are told to try.
    # The panel tells the reader to refresh and try again. The screen's
    # refresh does not reach it, and that is held on purpose rather than
    # forgotten: re-running a read nothing is showing is work for nobody, and
    # the set of reads the control re-issues is pinned so that adding this one
    # fails. So the sentence names the one control that cannot act on it.
    #
    # The retry belongs to the panel instead. It owns the read, it is the only
    # thing that knows the period is open, and it is where the reader is
    # already looking when they are told to try again.

  @integration
  Scenario: A period the server declined says so instead of offering a retry
    Given the records behind a provider's period are open
    When the server declines that read because the plan does not cover it
    Then the records say the reader does not have access to them
    And nothing there offers to try the read again
    And nothing there says the records are still being read
    # The same rule the lanes above this panel already follow: a decline is
    # not a fault. This read carries the permission and plan gates the chart
    # above it already passed, so a reader meets a decline here only when
    # something changed under them between drawing the chart and opening a
    # period — the grant withdrawn, or the plan lapsed. Pressing again cannot
    # give either back.
    #
    # The third line is why the decline needs words of its own rather than
    # merely losing the button. Nothing is in hand and nothing is in flight,
    # so a panel that only stopped offering the retry would sit forever on
    # the line that says the records are being read.

  @integration
  Scenario: A period declined for want of a grant reads the same as one declined by the plan
    Given the records behind a provider's period are open
    When the server declines that read because the reader lacks the grant
    Then the records say the reader does not have access to them
    And nothing there offers to try the read again
    # Both declines are answered the same way here, deliberately. This panel
    # cannot tell a lapsed plan from a withdrawn grant without reading the
    # live plan, and naming the wrong one sends the reader to the wrong
    # place, so it names neither. The notice one screen up does read the live
    # plan and so can name one, and it replaces the whole body rather than
    # sitting beside the figures, so it is never beside an opened period.

  @integration
  Scenario: The screen does not quietly read the figures again on its own
    When a permitted viewer leaves the cost screen open
    Then the screen does not read the figures again by itself
    And returning to the window does not read them again either
    # The source pages do poll, and that stays true: a connection is
    # watched while it is being set up, and a failure there is minutes old.
    # This screen is read while a decision is being made, often with the
    # window shared, and figures that move under the reader are worse than
    # figures they chose to bring up to date. The reads are also expensive
    # and this screen carries several of them.

  @unit
  Scenario: A viewer can see the window split by provider over time
    Given a window in which two providers were billed in the same period
    And every day of that window carries a dollar figure
    When the provider breakdown is folded for the screen
    Then each period holds a separate figure per provider
    And those figures add up to the window total each provider already reports
    # The screen could say a provider cost a certain amount over a quarter
    # and could say the organization spent a certain amount on a given day,
    # and had no way to answer which provider caused a period that stood out.
    #
    # Checked on the fold rather than on the rendered panel because the panel
    # is now a chart, and a chart draws nothing at all under a test renderer
    # with no layout: its container measures zero and recharts declines to
    # plot into it. The arithmetic is the part that can be wrong, and this is
    # where it lives.

  @unit
  Scenario: The untotalled cost chart is bucketed by the interval too
    Given billed days at two providers that all fall inside one quarter
    When the window total is folded for a reader reading by quarter
    Then those days become a single period
    And its figure is what the two providers came to together
    # Its own scenario rather than a line on the one below, because the two
    # charts fold the same rows through different functions and only one of
    # them was ever folded. The unfolded one drew a bar per day under an axis
    # ticked by quarter: three hundred hairline bars, the quarter's name
    # repeated over each run of them, and one heavy day reading as the whole
    # quarter.

  @unit
  Scenario: The provider breakdown is bucketed by the interval the reader chose
    Given billed days at two providers that all fall inside one quarter
    When the provider breakdown is folded for a reader reading by quarter
    Then those days become a single period
    And each provider keeps a figure of its own inside it
    # The read answers in days, because days are what the rollup stores. The
    # screen has no day interval to offer a reader — month, quarter and year
    # are the only widths the Time Interval chip carries — so a panel that
    # drew a column per day drew a width nobody had asked for, and over a
    # year of history it drew several hundred of them side by side.

  @integration
  Scenario: A provider holding a period with no dollar figure shows no window total
    Given a window in which one provider has a day we hold no dollar figure for
    When a permitted viewer reads the provider breakdown
    Then that provider shows no total for the window
    And its bars are marked as covering only part of what was spent
    # Its other days each hold a real number, so a reader who adds the bars
    # up rebuilds exactly the partial sum the lane refused to show them.
    # The mark on the bars is what stops the chart from being that sum.

  @integration
  Scenario: A day with a withheld amount shows as withheld in cost over time, not as a smaller bar
    Given a window in which one provider has a day we hold no dollar figure for
    When a permitted viewer reads the cost over time
    Then the period holding that day is drawn as short, not as a smaller bar
    And a note under the chart names the provider that withheld
    # The total chart folds the same rows as the provider split beside it,
    # and a withheld day added nothing to either. The split said so under its
    # bars; the total chart said nothing, so the same period read as a cheap
    # one there and as an incomplete one a panel to the right. A figure
    # without a bill behind it is withheld, never zero, and a bar drawn at
    # the sum of the days that held a figure is a zero for the day that did
    # not — quietly, at the bottom of the bar.
    #
    # The bar itself is checked on the fold rather than on the render: the
    # bucket carries whether it is short and who left it so, and the chart
    # draws a short bucket faded and dash-edged and says so in its tooltip.
    # A chart draws nothing under a test renderer with no layout, so the
    # note under it is the part of this scenario the screen test can see.

  @integration
  Scenario: A period whose every day is withheld still shows a withheld mark
    Given a window in which a provider's only days hold no dollar figure
    When a permitted viewer reads the cost over time
    Then a dashed mark stands where that period's bar would be
    And the mark says the amount is withheld, in words a screen reader reads out
    # The rule above says a short period is drawn faded and dash-edged. For a
    # period with SOME figure that is enough, because there is a bar to fade.
    # A period with no figure at all has no bar: the chart draws nothing for a
    # height of zero, so a single-provider tenant with one unanswered bill got
    # an empty slot, indistinguishable from a period nobody spent anything
    # in — the exact reading a withheld figure exists to prevent. The mark is
    # a dash and a label, not a colour, so it survives greyscale and a screen
    # reader alike.

  @integration
  Scenario: The provider split marks a short period the same way the total chart does
    Given a window in which one provider has a day we hold no dollar figure for
    When a permitted viewer reads the cost over time by provider
    Then the period holding that day is drawn as short there too
    # One fold, two charts. Both panels are built from the same rows, and for
    # a while only the total chart carried the mark: the split was folded
    # straight from the day buckets, which know nothing of withheld days, so
    # the same period was faded on the left and plain on the right.

  @unit
  Scenario: A day billed partly in a currency with no dollar figure leaves its period short
    Given a day at one provider holding a dollar figure and a bill in a currency we hold no dollar figure for
    When the cost over time is folded
    Then the period holding that day is marked as short
    And the note under the chart names that provider and the currency
    And the period a reader would open is marked as partial
    # ONE DEFINITION OF SHORT. There are two ways a day gets short: a cell with
    # no amount at all, and a cell billed in a currency we could not convert,
    # which leaves a real but incomplete dollar figure. Each fold used to spell
    # the rule out for itself and two of them spelled out only the first half,
    # so a day billed in dollars and euros drew a whole bar over a note saying
    # part of its spend had no dollar figure. Every fold asks one predicate now.

  @unit
  Scenario: The period a reader opens is the span its bar was drawn from
    Given a provider billed on several days inside one period
    When that period is opened
    Then the span read for it starts on the first of those days
    And it ends on the last of them
    # The bar and the records under it have to be the same money. Taking the
    # span from the calendar bounds of the period instead would reach past
    # both ends of the window on the first and last bars it draws, and the
    # records would then total more than the bar a reader clicked.

  @unit
  Scenario: The records behind a period cover every day the period holds
    Given a provider billed on several days inside one period
    When the records behind that period are read
    Then every day in the period is counted into them
    And no day outside the period is
    # A period is what the reader clicked, so the records under it have to be
    # the whole of what they clicked. Reading only the day the period opens
    # on would answer a question nobody asked and would disagree with the
    # bar directly above it.

  @integration
  Scenario: A window billed in two currencies shows one total per currency
    Given a window holding spend billed in dollars and spend billed in euros
    When a permitted viewer opens the cost screen
    Then a separate total is shown for each currency
    And no figure on the screen combines the two
    And no exchange rate is applied to produce either

  @integration
  Scenario: A currency nobody converted still totals in the currency it was billed in
    Given spend billed in a currency the provider published no dollar figure for
    And nothing else was billed in the window
    When a permitted viewer opens the cost screen
    Then that currency has a total of its own
    And the dollar total is unchanged by it
    And the screen shows the bill rather than treating the window as unbilled
    # The amount in the provider's own currency has been stored on every row
    # since the summary was built and has never been read by any total. The
    # dollar column being empty is not the same as there being no money.
    #
    # The last line is the regression this scenario now guards. A lane billed
    # only in euros has no dollar figure and no unpriced cell — every cell
    # holds an amount, in euros — and the check that decides whether a bill
    # was reported asked only those two questions. A real euro bill read as
    # no bill, and the screen fell back to invented figures over the top of
    # it.

  @unit
  Scenario: A currency total is withheld when part of what it covers holds no amount
    Given spend billed in one currency where part of it holds no amount at all
    When the window totals are read
    Then no total is shown for that currency
    And it says part of what it covers is unpriced
    # An amount of zero and no amount at all are written the same way in
    # the provider-currency figure, so the parts holding no amount are
    # counted separately. Without that count a day nobody ever priced
    # charts as a genuine nothing in the provider's own currency — the one
    # thing the dollar figure was allowed to be empty in order to prevent.

  Rule: The summary says where its numbers stop being complete
    # ADR-128 4a. A source whose pulls keep failing brings nothing back, so it
    # reports no spend, so the lanes fall. The summary carries that fact so a
    # reader is not left taking a stalled pull for a cheap month.
    #
    # THE COST SCREEN NO LONGER DRAWS IT. Two warning banners stood above the
    # lanes — one for a failing pull, one for days read while cost recording
    # was off — and both are gone at the product owner's direction: that
    # screen is read while a decision is being made, often with the window
    # shared, and it opens with figures rather than with caveats about them.
    # The source pages carry the same fact, beside the source a reader would
    # have to go to anyway to act on it. What follows is therefore about what
    # the summary REPORTS, and no longer about what the screen shows.
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
    # The breakdown reads the PULLED lane only. The gateway lane used to
    # write actor ids into the same table under a different provider
    # vocabulary; those rows were never deleted, so letting them in would
    # both mislabel and cross-sum the lanes the screen keeps apart.

    @unit
    Scenario: Pulled spend is grouped by who spent it
      Given pulled cost recorded under two different spender ids at one provider
      When the spender breakdown is read
      Then each spender's rows total under their own spender and nobody else's

    @unit
    Scenario: Gateway rows never enter the spender breakdown
      # The rollup holds the pulled lane plus the gateway rows an earlier
      # fold left behind, which nobody counts. An unfiltered read would
      # satisfy every other scenario here while quietly summing that
      # leftover gateway money into a spender's pulled total — the
      # cross-lane sum this screen exists to refuse.
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

  # =========================================================================
  # THE CONNECTED VIEW WAS DESIGNED AND ITS INPUT WAS REMOVED.
  #
  # A rule here used to park eight scenarios for a view that would show one
  # provider day as a bill split into the part the gateway saw and the part it
  # did not — "$4.20 of the $6.00 attributed; $1.80 not seen by gateway" — plus
  # a variance line when metering ran over, and an estimated tag until the bill
  # landed. Every one of them started from an admin's mapping saying which
  # gateway keys a given bill pays for. That mapping was deleted outright on
  # 2026-09-04 (ADR-128 section 7, marked deleted; the model, migration,
  # service, repository, tests and its own fifteen-scenario spec all went with
  # it), and nothing replaced it. A scenario cannot describe a split whose only
  # input no longer exists, so the eight were removed rather than left parked:
  # a parked scenario is a promise, and this one had stopped being one.
  #
  # What ships instead is the wave-1 shape, and it is bound elsewhere in this
  # file rather than restated here:
  #
  #   - the lanes stand side by side, each labeled with its own figure, and
  #     nothing merges them - "Each lane renders its own labeled total";
  #   - a provider day that is a refund shows negative, unclamped - "A
  #     refund-heavy billed day renders negative as reported";
  #   - a lane holding usage billed in a currency we cannot state in dollars
  #     withholds its total and says which currency - "A lane with usage we
  #     cannot state in US dollars holds no total" and "A lane with no total
  #     says why instead of showing a figure";
  #   - a day the provider may still restate is marked as able to change, from
  #     the settling window rather than from the absence of a bill - see
  #     specs/governance/governance-cost-restatement-markers.feature.
  #
  # If the connected view is ever revived it needs a new coverage decision
  # first; these scenarios would be written against that, not recovered from
  # here.
  # =========================================================================

  Rule: Pulled spend says which model it was spent on

    # ADR-128 §1: wave 1 answers WHERE the money goes — company, source,
    # agent, model. The model is the one of those four that every pulled
    # provider already fills, so this Rule is the read that puts it on the
    # screen. It reads the SAME rollup the billed lane reads, not the metered
    # trace store: pulled bills are the only money this deployment has, and a
    # panel pointed at the traces reported "nothing in this window" over a
    # table that held the answer.
    #
    # Grouped by the model string EXACTLY as the provider reported it. A
    # provider that bills per token kind writes a line item ("<model>, input")
    # and that is what its bill says; splitting it here would invent a
    # grouping the provider did not report and would silently merge two
    # figures a reader may need apart.
    #
    # The breakdown reads the PULLED lane only, for the reason the spender
    # breakdown does: the gateway lane used to write a different provider
    # vocabulary into the same table, its leftover rows are still there,
    # and an unfiltered read would cross-sum the two lanes this screen
    # keeps apart.

    @unit
    Scenario: Pulled spend is grouped by the model the provider named
      Given pulled cost recorded under two different models
      When the model breakdown is read
      Then each model's rows total under their own model and nobody else's

    @unit
    Scenario: Gateway rows never enter the model breakdown
      Given pulled cost and gateway cost recorded for the same model
      When the model breakdown is read
      Then only the pulled rows are counted

    @unit
    Scenario: A model billed per token kind keeps the line item the provider sent
      # OpenAI's admin bill names a line item rather than a bare model, and
      # the puller stores it unsplit on purpose. The read repeats it.
      Given pulled cost recorded under a line item naming a model and a token kind
      When the model breakdown is read
      Then the row is named with the line item exactly as it was billed

    @integration
    Scenario: The ranked model panel fills from the billed lane
      # Reported from a live screen: every model the organization had been
      # billed for was sitting in the rollup and the panel said the window
      # held nothing, because it was reading the metered trace store instead.
      Given billed spend recorded against two models
      And a reader who has turned the invented panels off
      When the cost screen is drawn
      Then the model panel names both models
      And it does not say the window holds nothing

    @unit
    Scenario: A model holding an unpriced cell states no figure
      # The same withholding rule every other figure on this screen obeys: a
      # priced part alone reads as the whole one, and the reader has no way
      # to see it is short.
      Given a model whose rows include a cell with no amount
      When the model breakdown is read
      Then that model states no figure
      And it reports how many of its cells hold no amount

    @integration
    Scenario: A model the screen cannot price is listed without a figure
      # The panel used to DROP such a model. Dropping it is the one reading
      # that cannot be right: the money was billed, and a list that leaves it
      # out reports a smaller bill than the provider sent. A window whose
      # models were all unpriced then emptied the panel entirely, so the
      # screen said it had measured nothing over rows it was holding.
      Given billed spend recorded against a priced model and an unpriced one
      And a reader who has turned the invented panels off
      When the cost screen is drawn
      Then the model panel names both models
      And the unpriced model shows no figure in place of a number

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

    @integration
    Scenario: A declined summary read leaves its panels saying what would fill them
      Given a reader whose cost read is declined
      And a reader who has turned the invented panels off
      When the cost screen is drawn
      Then the panels folded from that read say what would fill them
      And none of them says it could not be brought up to date
      # Nothing failed and nothing needs retrying, so telling this reader that
      # refreshing again is worth a try sends them after a fix that does not
      # exist. The failure marker is for failures; a decline keeps the empty
      # copy, the same line the billed-spend-by-person panel draws.

    @integration
    Scenario: A declined day-split read leaves its panels saying what would fill them
      Given a reader whose day-split cost read is declined
      And a reader who has turned the invented panels off
      When the cost screen is drawn
      Then neither provider chart says it could not be brought up to date
      # Both charts are folded from that one read, so a refusal marks both or
      # neither, and the advice the marker carries cannot work against one.

  Rule: A read that genuinely broke still reports the failure

    @integration
    Scenario: A failed day-split read still marks its panels unrefreshed
      Given a day-split cost read that fails with a server fault
      When the cost screen is drawn
      Then a provider chart says it could not be brought up to date

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

  # =========================================================================
  # TOKENS ON THE COST SCREEN. Money answers "what did this cost", which is
  # the wrong question for an organization buying assistants on subscription:
  # the per-request cost of a bundled seat is zero, so a department of heavy
  # subscription users reads as nearly free. Tokens are true under both
  # pricing models, and dollars are not.
  #
  # The trade taken here is deliberate. A token ranking is a worse cost
  # ranking across a mixed model estate — ten million tokens through a cheap
  # model can cost less than one million through an expensive one while
  # ranking ten times larger — and these are ranked panels. The dollar figure
  # is kept beside the tokens rather than dropped, so the reader has both.
  #
  # THE NUMBER IS THE WORK THE MODEL DID, NOT THE WORK THE CUSTOMER PAID FOR.
  # The gateway ledger stores a BILLABLE input count with cache already taken
  # out of it, because the rating path prices each token once at its own rate.
  # That is right for money and wrong for a count: agent traffic is
  # overwhelmingly cache reads, so a panel counting the stored column alone
  # would report a small fraction of what the models actually processed, on
  # the screen a customer opens to size their usage. Cache is added back.
  # Audio and image tokens arrive subtracted out for the same rating reason
  # and are added back too.
  #
  # Two of the ledger's quantities are SUBSETS of quantities already in the
  # sum, and adding them would count the same tokens twice: reasoning is part
  # of the output count, and the longer-lived portion of a cache write is
  # part of that cache write. Three more are not tokens at all — characters,
  # audio duration and a count of pictures.
  #
  # The two stores do NOT agree, and nothing here claims they do. The
  # gateway's own customer trace publishes the cache-subtracted figure, and
  # audio and image counts never reach the trace store. Same call, different
  # numbers, on purpose — which is why every panel below has to name the
  # store it counted in.
  # =========================================================================

  Rule: One word, one number — tokens mean the same thing in every panel

    @unit
    Scenario: The metered token count counts what the model read, cache included
      Given a gateway request whose prompt was 4,814 tokens, 4,736 of them served from cache
      When the metered token figure for that request is read
      Then it reports 4,814 tokens
      And it does not report the 78 tokens left once cache was taken out

    @unit
    Scenario: Reasoning tokens are not added on top of the output they are part of
      Given a gateway request whose output includes reasoning tokens
      When the metered token figure for that request is read
      Then those reasoning tokens are counted once, inside the output count
      And the figure is not the output count plus the reasoning count again

    @unit
    Scenario: A longer-lived cache write is not added on top of the write it is part of
      Given a gateway request whose cache write bought the longer retention
      When the metered token figure for that request is read
      Then those tokens are counted once, inside the cache write count
      And the figure is not the cache write plus the longer-lived portion again

    @unit
    Scenario: The metered token count adds back the tokens that were priced separately
      Given a gateway request whose audio and image tokens were priced at their own rates
      When the metered token figure for that request is read
      Then the audio and image tokens are counted alongside its text tokens

    @unit
    Scenario: Characters, audio duration and a picture count are not tokens
      Given a gateway request metered in characters, in audio milliseconds and in pictures
      When the metered token figure is read
      Then none of those three quantities is counted as a token

    @integration
    Scenario: A window of speech reports no tokens and still reports its cost
      Given a window whose every request was metered in audio duration alone
      When a permitted viewer opens the cost screen
      Then the token figure for that window is zero
      And the metered lane still shows what that traffic cost
      # Tokens are blind to speech the way dollars are blind to subscriptions.
      # Both lanes stay on the screen so neither blind spot is the only view.

    @integration
    Scenario: Tokens over time draws the metered lane instead of standing empty
      Given gateway requests carrying tokens across the window
      When a permitted viewer opens the cost screen
      Then the tokens-over-time panel draws the tokens those requests used, period by period
      And it does not say nothing has been recorded in this window

    @integration
    Scenario: Tokens over time says nothing about a window nobody read
      Given the cost summary read has not answered
      When a permitted viewer opens the cost screen
      Then the tokens-over-time panel names what it shows and what would fill it
      And it does not say nothing has been recorded in this window
      # The two blank states are not the same claim. A read that answered with
      # no days measured the window; a read still in flight measured nothing,
      # and a panel that reports "nothing in this window yet" from that state
      # states a finding the screen does not have.

    @integration
    Scenario: Every token figure names the store it was counted in
      Given tokens recorded in the gateway ledger and tokens recorded on traces
      When a permitted viewer opens the cost screen
      Then each panel showing tokens says on its own face which store counted them
      And a panel reading the gateway says so in the panel, never only in a footnote
      And no panel shows one token figure covering both stores
      # The two stores measure different things for the same call, so they
      # will disagree, and the label is what stops that reading as a defect
      # in one of them. The universal negative — that nothing anywhere adds
      # two token figures together — is the same code-review gate as "never
      # summed into one figure" above, for the same reason.

  # =========================================================================
  # THE PANELS THAT COUNT PEOPLE. Two of them, and until now they disagreed
  # about what they were measuring while sitting on the same screen. One was
  # titled for a lane it does not read: "metered" names the gateway ledger
  # everywhere else here, and the gateway lane is not allowed to be grouped
  # by person at all — see "Metered spend is grouped by model and by virtual
  # key, never by person" above. A panel cannot be fixed by filling it while
  # its title still points at the wrong store.
  #
  # A department buying its assistants on subscription has no measured
  # tokens either: those conversations are assembled deliberately cost-free
  # and they arrive token-free too, so the panel either reads nothing or
  # reads an estimate. Neither is a measurement, and the row says which it
  # is rather than printing a zero — the rule that a panel never states a
  # number it did not measure holds here too instead of being carved out.
  # =========================================================================

  Rule: A people panel measures tokens and says which store it read

    @integration
    Scenario: A department reports the tokens it ran, across every project of the organization
      Given a department whose people ran traffic under two projects of the viewer's organization
      And traffic under a project of another organization
      When a permitted viewer opens the cost screen
      Then the department leads with a token count covering both of the organization's projects
      And the other organization's traffic contributes nothing
      And the figure it leads with is not a dollar amount

    @integration
    Scenario: A department of subscription users shows the tokens it really used
      Given a department whose assistants are bought on subscription
      And every one of its requests carries no per-request cost
      When a permitted viewer opens the cost screen
      Then that department's token figure reflects the traffic it ran
      And it is not reported as one of the cheapest departments on the strength of a zero

    @integration
    Scenario: A department with no token rows says it was not measured
      Given a department whose traffic carries no token counts at all
      When a permitted viewer opens the cost screen
      Then that department's row says its tokens were not measured
      And it does not show a token count of zero

    @integration
    Scenario: A department whose tokens were estimated says so on its row
      Given a department whose tokens were counted by the estimator rather than reported by a provider
      When a permitted viewer opens the cost screen
      Then that department's row is labeled as estimated
      And a department whose tokens a provider reported carries no such label

    @integration
    Scenario: The department panel keeps its dollar figure as a second line
      Given departments with both token counts and per-request costs
      When a permitted viewer opens the cost screen
      Then each department leads with its token count
      And its dollar figure is shown beneath, saying it covers per-request cost only

    @integration
    Scenario: The panel counting people is titled for the store it reads
      Given the cost screen is drawn for a permitted viewer
      When the panel ranking people by their tokens is read
      Then its title names the store those tokens were counted in
      And it does not describe itself as metered gateway spend

    @integration
    Scenario: The panel counting people reports tokens rather than dollars
      Given people with both token counts and per-request costs recorded
      When a permitted viewer opens the cost screen
      Then each person leads with their token count
      And the people shown first are those with the most tokens, not those with the largest dollar figures
      # The panel is ranked and paginated on the server. Shipping the unit
      # without the sort key leaves page one ordered by dollars while showing
      # tokens, and a "top ten" that is not the top ten.

    # The two people-facing panels agreed on the unit and disagreed on who
    # they counted. The department one covers every project of the
    # organization; the person one covered the hidden governance project
    # alone, and within it only traffic that arrived through a governance
    # source. Side by side over the same rows, one printed a token count and
    # the other said nothing had been recorded.
    @integration
    Scenario: The panel counting people covers every project of the organization
      Given people whose traffic ran under a project of the organization other than the governance one
      And none of that traffic arrived through a governance source
      When a permitted viewer opens the cost screen
      Then those people appear on the panel ranking people by their tokens
      And the tokens it counts for them are the tokens the department panel counts

    # Only this screen's panel widens. Three other screens read the same
    # per-person figures and still lead with dollars, and a spend figure must
    # not move as a side effect of a fix aimed at this panel.
    @unit
    Scenario: A reader of the person figures other than the cost screen keeps the governance scope
      Given a screen reading the per-person figures without naming a population
      When it asks for them
      Then it is answered over the hidden governance project alone
      And only over traffic that arrived through a governance source

    # The hidden governance project is minted by connecting a provider bill,
    # so an organization that never connected one has none — and that says
    # nothing about whether its people ran any traffic.
    @unit
    Scenario: People active in an organization with no governance project appear on the person panel
      Given an organization whose people ran traffic in its own projects
      And no hidden governance project has ever been minted for it
      When a permitted viewer opens the cost screen
      Then those people appear on the panel ranking people by their tokens

  # =========================================================================
  # SEATS ARE BOUGHT PER PRODUCT. An organization holds a pool per product,
  # and the pools are separate purchases that renew on their own dates. Two
  # things go wrong when they are folded onto a shared time bucket.
  #
  # The fold keeps the LATEST report in each bucket, which is right for a
  # level and wrong for a set of pools: it replaces the bucket's whole set of
  # figures with the latest day's, so a pool whose newest report fell earlier
  # in the bucket is dropped entirely. Because pools renew on their own
  # dates, different report days are the normal case, not the edge — and two
  # pools reported on the SAME day travel together, so a case built on those
  # would pass against the fold as it stands and prove nothing.
  #
  # And a layer earlier the pools are already gone: they are added into one
  # bought figure and one assigned figure before the fold ever sees them,
  # which reads on screen as an organization that bought a single product.
  # =========================================================================

  Rule: Every seat pool keeps its own row

    @unit
    Scenario: Two seat pools whose newest reports fall on different days both survive the fold
      Given one pool whose newest counts were reported early in the bucket
      And a second pool whose newest counts were reported later in the same bucket
      When the counts are folded to the bucket in view
      Then both pools are reported in that bucket
      And each shows the counts of its own newest report

    @unit
    Scenario: Each seat pool draws its own bought-against-assigned pair
      Given seat counts for two products
      When the seat panel is read
      Then each product draws its own pair of seats bought against seats assigned
      And no figure on the panel adds the two products' counts together

  # =========================================================================
  # ADOPTION IS AN ORGANIZATION QUESTION. An admin asking how many of their
  # people use assistants means everybody, not the people who happen to
  # appear in one project. The count is read against the hidden governance
  # project alone, while assistant traffic lands in the organization's
  # application projects — so the read answers correctly for the one project
  # it was given and understates the organization every time. The figure is
  # presented as a measurement, so the reader has no way to tell.
  #
  # Only the HEADCOUNT widens. The money figures on the same card keep the
  # scope they have, because a spend figure must not change as a side effect
  # of a headcount fix, and the guard that reports "nothing connected" as
  # unmeasured rather than as zero stays exactly as it is — see "An adoption
  # count of zero with nothing connected is not reported as a measurement"
  # above.
  # =========================================================================

  Rule: Adoption counts the people of the whole organization

    @unit
    Scenario: Somebody active in another project of the organization is counted
      Given a person whose assistant traffic ran under a project of the organization other than the governance one
      When a permitted viewer opens the cost screen
      Then that person is counted among the people using AI tools

    # The count of people who are NEW is a stand-in until the per-user
    # first-seen record exists: everybody active counts as new when the
    # organization had nobody active before. That "before" has to be asked of
    # the same people the count describes. Asked of the hidden governance
    # project's bill instead, an organization whose teams were busy all along
    # is told every one of its people arrived this month, the first month its
    # governance project happens to bill nothing.
    @unit
    Scenario: An organization active before this window reports nobody as new
      Given people were active across the organization in the window before this one
      And the hidden governance project billed nothing in that earlier window
      When a permitted viewer opens the cost screen
      Then nobody is reported as new

    # The hidden governance project exists to scope the MONEY, and an
    # organization only mints one once somebody connects a provider bill. Its
    # people are its people either way, so gating the headcount on that
    # project answers an organization question with one hidden project's
    # existence, and reports a busy organization as having nobody.
    @unit
    Scenario: People active in an organization with no governance project are still counted
      Given an organization whose people ran assistant traffic in its own projects
      And no hidden governance project has ever been minted for it
      When a permitted viewer opens the cost screen
      Then those people are counted among the people using AI tools
      And no spend figure is reported for the organization

    @unit
    Scenario: An organization with no prior activity reports everybody as new
      Given nobody in the organization was active in the window before this one
      When a permitted viewer opens the cost screen
      Then everybody active is reported as new

    # Both windows come back from one read, so the scenarios above hold only
    # if that read is correct against a real store. The ones below execute it:
    # a query that splits the windows at the wrong instant, loses the second
    # project, or counts a superseded row's attribution answers plausibly and
    # wrongly, and no assertion on the query text can tell.
    @integration
    Scenario: Each window counts its own people across every project of the organization
      Given people active in this window, in the window before it, and in both
      And one of them worked only in a second project of the organization
      When the adoption headcount is read
      Then each window reports its own people
      And somebody active in both windows is one person in each figure

    @integration
    Scenario: A superseded version of a trace does not add a person
      Given a trace whose current version attributes it to a different person than an earlier version did
      When the adoption headcount is read
      Then only the person on the current version is counted

    @integration
    Scenario: An organization with no traffic reports nobody in either window
      Given projects holding no assistant traffic at all
      When the adoption headcount is read
      Then both windows report nobody
