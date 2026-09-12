@governance @cost
Feature: Daily cost rollup that can always be rebuilt and never lies
  Every cost event folds into one summary row per day and dimension. The
  summary is a pure consequence of the event history: rebuild it and you get
  the same numbers. When a provider revises a day, the new figure replaces
  the old on screen and the change stays visible. Different currencies stay
  different numbers. Watchdogs catch drift before a customer does.
  Decision: ADR-128.

  Background:
    Given an organization with recorded cost events

  @integration
  Scenario: A day's spend lands as one summary row per dimension combination
    When cost events for one day and one dimension combination are processed
    Then the summary holds exactly one row for that day and combination
    And its amount is the sum of those events

  @integration
  Scenario: Two spenders with identical numbers stay two rows after compaction
    Given two different spenders with the same provider, model, day, and amount
    When their events are processed
    # Force the background merge (OPTIMIZE ... FINAL) BEFORE asserting.
    # Storage keeps both rows until it compacts, so without forcing the
    # merge this passes even when the spender is missing from the dedup key
    # — and then the first real merge silently deletes one spender's money
    # (the migration-00069 bug class named by ADR-128).
    And the summary storage is compacted
    Then the summary still holds a separate row for each spender

  @integration
  Scenario: Amounts in different currencies stay separate rows after compaction
    Given one day has events in two currencies
    When the day is summarized
    # Same rule as the two-spenders scenario: compact first, then assert,
    # or a currency missing from the dedup key hides until the first merge
    # deletes one currency's money.
    And the summary storage is compacted
    Then each currency keeps its own total
    And no combined single figure is produced

  @integration
  Scenario: A restated day reads as the restated amount even before compaction
    Given a day was summarized at one amount
    When the provider restates that day at a different amount
    # Assert WITHOUT compacting storage: both versions of the row are still
    # present, and a plain SUM would return their total. The read must be
    # version-aware (argMax / IN-tuple per ADR-015) to pass. This is the
    # test that must FAIL on a naive read.
    Then reading the summary returns only the restated amount
    And the reader can see the day was revised and what it was before

  @unit
  Scenario: A pulled event in another currency is summarized under that currency
    Given a pulled usage event whose provider billed in a currency other than dollars
    When that event is summarized
    Then the summary row names the currency the event carried
    And it is not filed under dollars
    # Driven through the real summarizing step from a real event, not by
    # building the row by hand: the currency has to survive the trip from the
    # event, and a hand-built row proves only that the row has a field.

  @unit
  Scenario: A non-dollar day reports no dollar figure unless the biller gave one
    Given a pulled usage event in a currency other than dollars
    And the provider published no dollar equivalent for it
    When that event is summarized
    Then the row's dollar figure is absent rather than zero
    And the row still carries the full amount in the currency it was billed in
    # Absent and zero are different facts. Zero charts as free usage and would
    # quietly erase real spend from a dollar total; absent says we hold money
    # here that no dollar column can honestly state.

  @unit
  Scenario: The biller's own dollar conversion is what the dollar figure reports
    Given a pulled usage event carrying both its own currency and the biller's dollar equivalent
    When that event is summarized
    Then the row keeps the provider's own amount and currency
    And the row's dollar figure is the one the provider published
    And that figure is not derived from the original amount by any rate
    # We never invent a rate. The only dollar figure we will state is one the
    # biller itself stands behind, and it is a separate number carried from
    # ingest rather than anything this step calculates.

  @unit
  Scenario: A day in two currencies keeps a separate running total for each
    Given one day holding events in two different currencies
    When they are summarized
    Then each currency has its own total
    And no total mixes the two

  @unit
  Scenario: A credit summarizes against the charge it reverses
    Given a day holding one charge and a later credit of the same size in the same currency
    And the two are separate items rather than a revision of one
    When they are summarized
    Then the day's total for that currency reads as zero
    # Two items, not a restatement: a restatement replaces and would read as
    # zero even if credits were being dropped, which is the failure this is
    # meant to catch.

  @unit
  Scenario: The watchdog compares the amount in the currency it was billed in
    Given a summary row in a currency other than dollars that disagrees with its events
    When the comparator runs
    Then the drift is counted
    # Comparing the dollar column makes the watchdog blind exactly where that
    # column is empty by design — every non-dollar row, where both sides read
    # as absent and agree with each other while the real amounts differ. The
    # comparison has to be on the billed amount, which every row has.

  @integration
  Scenario: Rebuilding the summary from history reproduces it exactly
    Given a populated summary
    # Seed inside the event-log retention horizon (ADR-022), or the replay
    # proves nothing.
    When the summary is rebuilt from the event history
    Then every row matches the original summary

  @integration
  Scenario: Trace cost stays out of the rollup
    # ADR-128 reserves the trace lane and excludes it from wave 1: trace
    # cost must not appear in the summary under any cost source label.
    Given the organization has trace cost for a day
    When that day is summarized and read
    Then no summary row carries trace cost

  @integration
  Scenario: The comparator counts a summary that drifted from its events
    Given a summary row that no longer matches the sum of its events
    When the scheduled comparator runs
    # Reported = the mismatch metric increments (prom-client counter,
    # labelled by cost source, org in the log line). Wave 1 surfaces
    # signals and sends nothing — no alert fires anywhere.
    Then the drift metric counts the mismatch
    And the mismatch details are in the log

  # The comparator checks the billed lane alone. It once checked the
  # gateway lane too, and the scheduled rows it created for that half are
  # still in the database; they are marked inactive at start and a start
  # never recreates them. A row that fires anyway, racing that boot step,
  # settles as delivered so the scheduler does not retry the slot.

  @integration
  Scenario: The nightly rollup check covers the billed lane alone
    Given a scheduled check of the metered lane left over from before
    When the app starts
    Then that scheduled check is marked inactive
    And a later start leaves it inactive
    And the billed lane's check stays active

  @integration
  Scenario: A leftover metered check that fires anyway settles quietly
    Given a scheduled check of the metered lane that fires after all
    When it runs
    Then it completes without an error
    And that slot is not retried

  @unit
  Scenario: The summary's lag behind the event log is measured
    Given events newer than the latest summarized moment
    When the lag is computed
    # Exposed as a gauge per lane; the assertion is the computed value,
    # not a threshold or an alert.
    Then it reports how far the summary is behind

  # --- A correction that moves the day to a different cell ---
  # A correction usually lands on the same day under the same provider,
  # model and currency, and replaces the figure in place. When the provider
  # reissues the same charge under a different currency it lands somewhere
  # else instead, and the first version is left behind holding its money
  # with nothing to say it was superseded. Both are then live, and a total
  # across the day carries the same bill twice.
  #
  # This covers only the things a charge is deliberately not identified by:
  # the currency it was billed in, the agent it was attributed to, and the
  # spender the provider named. A charge arriving under a different model
  # or a different provider is a different charge as far as anything here
  # can tell, so it is not retracted, and that gap is stated rather than
  # papered over - a day holding several models is the ordinary case, so
  # retracting on a model change would zero genuine spend.

  @unit
  Scenario: A correction that arrives under a different currency retracts what it replaces
    Given a day summarized from a bill issued in one currency
    When the provider reissues that same bill in another currency
    Then an event retracts the amount held under the first currency
    And the day holds the reissued amount under the second currency only
    # Retracted by an event rather than by editing or deleting the earlier
    # row: the summary is a consequence of the event history, so a fix that
    # only reaches storage is undone by the next rebuild.

  @unit
  Scenario: A correction that arrives against a different spender retracts what it replaces
    Given a day summarized from a charge the provider attributed to one spender
    When the provider reissues that same charge against another spender
    Then an event retracts the amount held against the first spender
    And the day holds the reissued amount against the second spender only
    # The same defect, reached by a different door. Fixing only the
    # currency case leaves this one and the agent one open behind it.

  @integration
  Scenario: A day whose bill changed currency is never counted under both
    Given a day summarized from a bill issued in one currency
    When the provider reissues that same bill in another currency
    And the day is read across every currency it holds
    Then the first currency contributes nothing to the day
    And no total holds both versions of the one bill

  @integration
  Scenario: A retraction is dated to the day it corrects
    Given a day summarized from a bill issued in one currency
    When the provider reissues that same bill in another currency
    And the daily check re-derives that day from its recorded history
    Then the check sees the retraction
    And the day is not reported as disagreeing with its own history
    # The check re-derives a day from the events that fall inside that day.
    # A retraction dated when the correction arrived rather than when the
    # charge happened is never read by it, so the day would be reported as
    # drifting for as long as it is kept.

  @integration
  Scenario: A correction still retracts its earlier version after the summary is rebuilt
    Given a day summarized from a bill issued in one currency
    And the summary rebuilt from its recorded history
    When the provider reissues that same bill in another currency
    Then the amount held under the first currency is retracted
    And the day holds the reissued amount only
    # Where a charge landed the first time is written down beside the
    # summary as it is built, out of the same events, so a rebuild
    # reproduces it. Held only in memory it would be lost by every
    # restart, and looked for by searching the day it would mean reading
    # every row of that day on every correction.

  @integration
  Scenario: A cell priced in another currency is not a cell we hold no amount for
    Given a day holding one cell priced in dollars, one priced in euros, and one holding no amount at all
    When the day's totals are read
    Then exactly one cell is counted as holding no amount
    And the cell priced in euros is not counted among them
    # Two different absences. A euro cell holds a figure; what it does not
    # hold is a DOLLAR figure, and the euro line is where that figure is
    # shown. Counting it as unpriced withholds the dollar total of every day
    # that touches a foreign bill, and tells the reader we hold no figure for
    # money we hold a perfectly good figure for.

  # --- Recognising the reissue, rather than being told about it ---
  # Everything above describes what a retraction DOES once one exists. What
  # produces one is the gap: nothing compares the cell a charge sits in
  # against the cell the next pull of that same charge is about to land in.
  # So a reissue is only ever corrected by someone constructing the
  # correction by hand, and a day that nobody looks at carries the one bill
  # twice for as long as it is kept.
  #
  # Every version of one charge arrives on ONE ordered stream, because the
  # charge's restatement key is that stream's identity. So the comparison is
  # against where the charge sits NOW rather than where it first landed. A
  # record that never moves points at the original cell forever: the first
  # correction empties that cell, and every later pull withdraws from a cell
  # already holding nothing.
  #
  # The dimensions that may trigger this are exactly the three a charge is
  # deliberately not identified by - the currency, the agent and the spender.
  # The model is NOT among them: an adapter that does not list the model
  # among its dimensions files two models of one period under ONE restatement
  # key, so a comparison that included the model would read the second model
  # as a reissue of the first and withdraw money that was really spent.

  @integration
  Scenario: A bill reissued in another currency is withdrawn by the pull that finds it
    Given a source that has already pulled a day's bill issued in one currency
    When the next pull of that same day returns the bill in another currency
    Then the pull emits a retraction addressed to the first currency's cell
    And that cell is left stating zero rather than removed
    And the day totals the reissued amount only
    # The pull is the ONLY input. Nothing here constructs the correction,
    # which is what separates this from every scenario above it: those
    # describe a retraction that already exists, and this one is about
    # whether anything ever makes one. The emptied cell states zero rather
    # than going away because removing it would take its restatement key too.

  @integration
  Scenario: Pulling the corrected day again withdraws nothing
    Given a source whose reissued bill has already been withdrawn once
    When that same corrected day is pulled again unchanged
    Then the pull emits no retraction at all
    And the day still totals the reissued amount
    # Asserted on what the pull EMITS, because the totals alone would hold
    # even if a second retraction fired: it would withdraw from a cell
    # already at zero and move no money, while the day's revision markers
    # climbed forever against a correction that happened once.

  @integration
  Scenario: A charge reissued a second time is compared against where it sits now
    Given a source whose bill has already been reissued once in another currency
    When the provider reissues that same bill again against a different spender
    Then the pull emits a retraction addressed to the second cell, not the first
    And no earlier version of that bill is left holding money
    # Two corrections to one charge is the case a record of where the charge
    # FIRST landed gets wrong: the second correction would be compared
    # against a cell the first already emptied, leaving the middle version
    # live and the day carrying it on top of the newest one.

  @unit
  Scenario: A reissue is recognised from the currency, the agent and the spender only
    Given a charge already summarized for one model in a period
    When a charge for a different model arrives under that same restatement key
    Then nothing withdraws the first model's amount
    And both models' spend is left standing
    # A period holding several models is the ordinary case, not a correction,
    # and an adapter that does not list the model among its dimensions gives
    # both of them the same restatement key - so this premise is reachable,
    # not hypothetical. Comparing on the model would withdraw money that was
    # really spent, which is the one failure here that is worse than the
    # double-count this whole block exists to prevent.

