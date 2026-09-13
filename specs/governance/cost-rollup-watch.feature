@governance @cost
Feature: The daily cost check is driven by the charges, not by a clock
  As the team that answers for the cost figures we publish
  I want the drift check to run only where money actually moved, and to cover
  every day that moved rather than only yesterday
  So that a correction dated last week is still checked, and an organization
  that spent nothing costs us nothing to check.

  A pulled charge marks its own day as needing a check and arms a single
  reminder for the next 04:23 UTC. Repeats collapse into that one reminder.
  When it comes due, every marked day is compared once against its recorded
  charges, and the marks are cleared. The comparison itself is unchanged:
  it counts drift and writes the detail to the log. Decision: ADR-128.

  Background:
    Given an organization that pulls its provider bills
    And the daily check falls at 04:23 UTC

  Rule: A charge marks its own day and arms one check

    # The day is the day the charge HAPPENED, not the day it was pulled.
    # A bill pulled on Friday for Monday's usage is Monday's problem, and a
    # check that read the arrival time would compare a Friday that holds
    # nothing while Monday's drift sits there uncounted.

    @unit
    Scenario: The first charge of a day marks that day and arms a check
      Given the organization has no check armed
      When a pulled charge dated today is recorded
      Then today is marked as needing a check
      And a check is armed for the next 04:23 UTC after that charge

    @unit
    Scenario: A second charge on the same day neither marks it twice nor moves the check
      Given a pulled charge dated today has already been recorded
      When another pulled charge dated today is recorded
      Then today is marked exactly once
      And the armed check is still at the same moment
      # Both halves matter and they fail differently. Marking twice means the
      # day is compared twice for nothing; moving the check means a busy
      # organization pushes its own check forward with every charge and is
      # never compared at all.

    @unit
    Scenario: Charges on two different days mark both and still share one check
      Given a pulled charge dated today has already been recorded
      When a pulled charge dated yesterday is recorded
      Then both days are marked as needing a check
      And exactly one check is armed

    @unit
    Scenario: A correction dated an old day puts that old day back on the list
      Given the organization's charges for last Tuesday were checked and cleared
      When a retraction dated last Tuesday is recorded
      Then last Tuesday is marked as needing a check again
      # This is the gap the nightly job had: it compared yesterday and only
      # yesterday, so a provider correcting a week-old bill was never
      # re-checked and the drift it introduced went uncounted forever.

    @unit
    Scenario: A correction that arrives before the charge it corrects still marks its day
      Given the organization has no check armed
      When a retraction dated last Tuesday is recorded
      And the charge it corrects is recorded afterwards
      Then last Tuesday is marked as needing a check
      And it is marked exactly once
      # Pulled events reach this from one ordered stream per charge, but a
      # retraction and the observation it answers can be two streams, so the
      # order is not guaranteed. Marking must not depend on having seen the
      # observation first.

    @unit
    Scenario: The same charge delivered twice changes nothing
      Given a pulled charge dated today has already been recorded
      When the very same charge is delivered again
      Then today is still marked exactly once
      And the armed check is still at the same moment
      # A redelivery is not a second charge. Asserted separately from the
      # two-charges case because the two are stopped by different things —
      # one by the day being a set, one by the delivery being recognised as
      # a repeat — and an implementation can get either one alone.

  Rule: The moment a check is armed for is the next slot strictly after the charge

    @unit
    Scenario: A charge landing a minute before the slot is checked at that slot
      When a pulled charge is recorded at 04:22 UTC
      Then the check is armed for 04:23 UTC the same day
      # The sharp edge of the rule, pinned deliberately. The old nightly job
      # always compared a day that had been closed for hours; this one can
      # compare a day one minute after a charge landed on it. The summary is
      # written by a different reader of the same charges, so a comparison
      # this close behind can read a summary the charge has not reached yet
      # and count drift that is not real. If that bites, the fix is a minimum
      # settling time before the slot — not a looser comparison.

    @unit
    Scenario: A charge landing exactly on the slot waits for tomorrow
      When a pulled charge is recorded at exactly 04:23:00 UTC
      Then the check is armed for 04:23 UTC the following day
      And it is not armed for a moment that has already passed
      # The value between the two scenarios either side of it, and the one an
      # off-by-one gets wrong. Taking the slot that is not strictly in the
      # future arms a check that is due the instant it is written, so it
      # fires immediately and every charge after 04:23 becomes its own
      # comparison — the per-charge fan-out this design exists to avoid.

    @unit
    Scenario: A charge landing just after the slot waits for tomorrow
      When a pulled charge is recorded at 04:24 UTC
      Then the check is armed for 04:23 UTC the following day

    @unit
    Scenario: A charge dated in the future does not pull an armed check earlier
      Given a check is already armed for tonight
      When a pulled charge dated three days from now is recorded
      Then that future day is marked as needing a check
      And the armed check is still tonight
      # Provider clocks run ahead and bills carry booking dates. The marked
      # day is compared tonight, before it has finished happening — which is
      # harmless, because a comparison re-derives whatever is there and a day
      # holding one charge agrees with itself. What is NOT acceptable is the
      # opposite, below.

    @unit
    Scenario: A charge dated in the future does not push the check out to that date
      Given the organization has no check armed
      When a pulled charge dated three days from now is recorded
      Then the check is armed for the next 04:23 UTC after now
      And it is not armed three days out
      # One bad timestamp from a provider must not silence an organization's
      # check for three days. Every other day marked in the meantime would
      # wait behind it.

    @unit
    Scenario: A charge carrying no usable moment is refused rather than marked
      When a pulled charge carrying no moment, or a moment that is not a date, is recorded
      Then no day is marked from it
      And the organization's existing marks and armed check are unchanged
      # Deriving a day from a missing or garbage timestamp writes a day that
      # never happened onto the list — permanently, since only a check clears
      # it — and then compares a day holding nothing against a summary
      # holding nothing, forever. Refusing is the only option that does not
      # leave a standing lie in the state.

  Rule: The check compares each marked day once and then disarms itself

    @unit
    Scenario: A due check asks for one comparison per marked day
      Given two days are marked as needing a check
      When the check comes due
      Then exactly two comparisons are requested, one per marked day
      And each names the organization, its day, and the pulled lane

    @unit
    Scenario: A due check clears the marks and disarms
      Given a day is marked as needing a check
      When the check comes due
      Then no days are left marked
      And no check is armed
      # Disarming is what makes a quiet organization cost nothing. Left
      # armed, every organization that ever pulled a bill wakes every night
      # forever — which is the nightly job again, wearing a different hat.

    @unit
    Scenario: A check that comes due with nothing marked asks for no comparison
      Given no days are marked as needing a check
      When the check comes due
      Then no comparison is requested

    @unit
    Scenario: A charge after the check arms the next one
      Given a check has come due and cleared its marks
      When a pulled charge dated today is recorded
      Then today is marked as needing a check
      And a check is armed again

    @unit
    Scenario: A first import marks every day it covers and compares them at one check
      Given a source is read from scratch and covers a year of bills
      When those charges are recorded
      Then every distinct day they cover is marked exactly once
      And exactly one check is armed for all of them
      When the check comes due
      Then one comparison is requested for each of those days
      # The largest real case, and the one where "one comparison per marked
      # day" stops being a two-item list: a first import asks for hundreds of
      # comparisons out of a single check. Written down so the cost is a
      # decision rather than a surprise — and so that an implementation
      # cannot quietly cap or drop days to keep the batch small.

    @integration
    Scenario: A charge arriving while the check is running is not lost
      Given a day is marked as needing a check
      When a charge dated another day is recorded while that check is being processed
      Then both days end up compared
      And neither day's mark is dropped without a comparison being asked for
      # Charges and checks reach the process down two different paths, so
      # this interleaving is structural rather than unlucky. The losing side
      # of the race must retry or re-arm, never quietly stand down holding a
      # day nobody will ask about again.

    @unit
    Scenario: A charge re-marking a day after tonight's check still gets that day compared again
      Given a day was compared at tonight's check and the marks were cleared
      When a charge dated that same day is recorded with a clock reading a moment before that check
      And the check comes due again at that same moment
      Then that day is compared a second time
      And no days are left marked
      # Two machines need not agree on the clock, and the worker that answers
      # a check can run its slot late, so a charge can carry a moment before
      # tonight's check and still be written after that check has run. It
      # marks the day again and arms the moment that has just gone by, the
      # check fires again immediately, and it asks for the same day at the
      # same moment as before. Told apart by the day and the moment alone,
      # that is indistinguishable from the request already made and is
      # dropped — exactly when the day was marked again because something
      # about it had changed.

  Rule: One comparison per day per slot, and a later slot is a new question

    @integration
    Scenario: The same check slot delivered twice compares a day only once
      Given a day was compared at last night's check
      When that same check slot is delivered again
      Then the day is compared only once in total
      And the drift count for that day is not raised twice
      # Wakes and their requests are delivered at least once, so the second
      # delivery is expected rather than a fault — including after a
      # comparison that already succeeded and crashed before being recorded
      # as done. The drift count is asserted as well as the run, because a
      # second run of a read-only comparison is otherwise invisible while it
      # doubles the number we report drift by.

    @integration
    Scenario: A day marked again after its comparison is compared again at the next slot
      Given a day was compared at last night's check
      When a charge dated that same day is recorded afterwards
      And tonight's check comes due
      Then that day is compared again
      # The counterweight to the scenario above, and the reason the slot is
      # part of what identifies a comparison. Recognising a comparison by the
      # day alone would let last night's record swallow tonight's request,
      # and a corrected day would never be re-checked — the exact defect this
      # whole feature exists to fix.

  Rule: An organization with no pulled charges is never checked

    @integration
    Scenario: An organization that has never pulled a bill has nothing armed
      Given an organization with no pulled charges at all
      When every armed check in the system comes due
      Then that organization has no check of its own
      And no comparison is requested for it
      # The nightly job ran for every governance organization whether or not
      # anything had happened, so the cost of checking scaled with how many
      # customers we had rather than with how much money moved.

    @integration
    Scenario: Gateway spend does not mark a day
      Given the organization's requests through the gateway are recorded
      When every armed check in the system comes due
      Then no comparison is requested for the gateway lane
      # The gateway lane is no longer compared at all: the cost screen reads
      # it straight off the per-request ledger and the summary is never
      # written with its cells, so a comparison would re-derive nothing and
      # find nothing on both sides — a check that could not fail.

  Rule: One check per organization, never one per charge

    @unit
    Scenario: Every charge of one organization feeds the same check
      When pulled charges from two different bills of one organization are recorded
      Then one check is armed for that organization
      And both days are marked on it

    @unit
    Scenario: One organization's charges never mark another's days
      Given two organizations both pull their bills
      When a charge dated today is recorded for the first
      Then the second has nothing marked
      And the second has no check armed

  Rule: A disagreement is drift only once it has survived every look

    # The summary and the check are driven by two separate queues, and nothing
    # orders one against the other. A charge landing shortly before the slot
    # can be re-derived by the check while the summary is still folding it, so
    # the two sides disagree for a few seconds about a rollup that is perfectly
    # correct. Reporting that would do double damage: a false alarm, AND the
    # day cleared, because a comparison that answers is a comparison that
    # happened and nothing marks the day again.
    #
    # At the moment of looking, a summary that is behind and a summary that is
    # wrong are the same picture. What tells them apart is time: a fold that is
    # behind catches up, and drift does not. So a disagreement costs a rung of
    # the check's retry ladder instead of an alert, and only one still standing
    # on the last rung — some seven and a half minutes of looking later — is
    # counted and logged.
    #
    # The ladder already existed, for comparisons that fail outright. This
    # spends it on comparisons that merely disagree, which costs nothing: a
    # comparison is a read.

    @unit
    Scenario: A disagreement found before the last look is looked at again
      Given a day whose summary and charges state different money
      And the check has looks left
      When the check compares that day
      Then no drift is counted for that day
      And the comparison is left to be attempted again

    @unit
    Scenario: A disagreement over a charge older than the summary's newest is looked at again
      Given a charge the summary has not folded that is older than the ones it has
      When the check compares that day
      Then no drift is counted for that day
      And the comparison is left to be attempted again
      # A late arrival stamped before the newest charge already folded cannot
      # move the summary's own watermark, so the summary reads as current. The
      # fold is order-independent by design, so this is ordinary rather than
      # pathological — and it is why looking again is not optional.

    @unit
    Scenario: A disagreement that survives every look is counted and logged
      Given a day whose summary and charges state different money
      And the check is on its last look
      When the check compares that day
      Then the drift is counted
      And the detail is in the log
      And the comparison is recorded as answered rather than given up
      # Answered, not dead. A comparison that gave up is filed as an outbox
      # failure, where nobody reads it — and real drift is the one finding this
      # whole process exists to surface.

    @unit
    Scenario: A disagreement the summary settles between looks is never reported
      Given a day whose summary and charges state different money
      And the summary catches up before the next look
      When the check compares that day again
      Then no drift is counted for that day
      And nothing is written to the log about that day
      # The guard on all of the above. Without it, a check that simply reported
      # every disagreement on its last look would satisfy the rest.

    @unit
    Scenario: A summary row still missing on the last look is counted as drift
      Given a pulled charge whose rollup cell the summary holds no row for
      When the check has looked at that day for the last time
      Then the drift is counted
      And the comparison is recorded as answered rather than given up
      # Money the log accounts for and the summary never folded is exactly what
      # the counter exists for. A cell the fold has not reached yet and a cell
      # the fold will never reach look identical at the moment of looking, so
      # this waits out the ladder first — and then reports, rather than letting
      # the row die in the outbox where the finding is filed as plumbing.

    @unit
    Scenario: Figures that agree over a summary still folding are looked at again
      Given a day whose summary has demonstrably not folded every charge it holds
      And the two figures nevertheless agree
      When the check compares that day
      Then the comparison is left to be attempted again
      # Agreement reached over a summary that is still catching up is a
      # coincidence, not a verdict: the unfolded charge nets to nothing, or
      # lands on a cell neither figure covers. Clearing the day on it is
      # permanent, because nothing marks that day again.

    @integration
    Scenario: A charge the summary has not folded yet is waited for rather than counted as drift
      Given a pulled charge landed just before tonight's check
      And the day's summary does not yet cover that charge
      When the check compares that day
      Then no drift is reported for that day
      And the comparison is left to be attempted again
      When the summary catches up with that charge
      Then the next attempt compares the day once and finds it agrees

  Rule: What one comparison can see of a summary that is still folding

    # Every summary row carries the newest charge moment folded into it, and
    # the check re-derives the same figure from the day's charges, so a summary
    # strictly behind its charges says so in its own numbers. That is the cheap
    # signal, and it puts a named reason on the first retry.
    #
    # It is one-sided, and the asymmetry is the point: a maximum cannot count.
    # Two charges sharing one moment leave it unmoved, so a summary that folded
    # one of them reads as level with a check that folded both. Nothing else in
    # the row does better, and an exact count of applied events would be a new
    # column every existing row lacks. So nothing may read this signal's
    # silence as permission to call a disagreement drift — that is the ladder's
    # judgment, above, and this only ever explains it.

    @unit
    Scenario: A charge the summary has not folded yet is named as still folding
      Given a pulled charge landed after the newest one the summary has folded
      When the check compares that day
      Then the cell is named as still folding, with both moments on it

    @unit
    Scenario: A summary that covers every charge of the day is named as behind by nothing
      Given a day whose summary covers every charge it holds
      When the check compares that day
      Then nothing is named as still folding
      And the difference between the two figures is stated

    @unit
    Scenario: A cell the summary holds nothing for is named as still folding
      Given a pulled charge whose rollup cell the summary holds no row for
      When the check compares that day
      Then the cell is named as still folding, with nothing folded into it
      # A cell the charges describe and the summary has never heard of is the
      # strongest form of behind, not a separate condition.

    @unit
    Scenario: A charge carrying no usable moment is never named as still folding
      Given a pulled charge that carries no moment the summary can be measured against
      When the check compares that day
      Then nothing is named as still folding
      # There is no evidence the summary is behind anything, and reading "we
      # cannot tell" as "behind" would put every such day on the slowest path
      # it has, on every run, forever.

    @unit
    Scenario: A charge sharing its moment with a folded one leaves the watermarks level
      Given two charges on one cell stamped with the same moment
      And the summary has folded only one of them
      When the check compares that day
      Then nothing is named as still folding
      And the difference between the two figures is stated
      # The blind spot, pinned so nobody builds on this signal again. Provider
      # exports commonly bucket timestamps, so this is the ordinary case rather
      # than a contrived one.

  Rule: A failing comparison is retried, and never holds up the money

    @integration
    Scenario: A comparison that has failed three times is attempted a fourth
      Given a comparison has failed on each of its first three attempts
      When its attempts continue
      Then it is attempted a fourth time

    @integration
    Scenario: A comparison that has failed five times is not attempted again
      Given a comparison has failed on each of its first five attempts
      When its attempts continue
      Then it is not attempted a sixth time
      And it is recorded as having given up
      # Two scenarios rather than one because a single "it is retried" pins
      # nothing: an implementation that gives up after two attempts, and one
      # that retries forever, both satisfy it. The pair fixes the number from
      # both sides, and the second names the record that a comparison died —
      # which is the only trace a dead check leaves.

    @integration
    Scenario: A failing comparison does not stop charges being recorded
      Given the comparison fails every time it is attempted
      When further pulled charges arrive
      Then those charges are still recorded
      And their days are still marked for the next check
      # The comparison is a watchdog. A watchdog that can wedge the pipeline
      # it watches is worse than no watchdog, because the damage it does is
      # to the money rather than to the confidence in it.

    @integration
    Scenario: Drift that outlives every look is counted and logged
      Given a day's summary no longer matches its recorded charges
      When the comparison for that day runs out of looks
      Then the drift is counted
      And the detail is in the log
      # What the comparison REPORTS is untouched by any of this — the counter
      # and both figures on the line. Stated here so a rewrite of when it is
      # trusted cannot quietly change what it says.

    @integration
    Scenario: A comparison that gave up is not picked up by a later check
      Given a comparison for a day gave up after its last attempt
      When the next check comes due with no new charges on that day
      Then that day is not compared
      # A known gap, stated rather than hidden. The marks are cleared when the
      # check comes due, not when the comparison succeeds, so a day whose
      # comparison died is only re-checked if something new lands on it. What
      # makes that acceptable is the record above: a comparison that gave up
      # is visible as having given up. Recovering it belongs to whoever reads
      # that, not here.

    @integration
    Scenario: A deployment that holds no summary at all asks for no comparisons
      Given a deployment where the cost summary store is not configured
      When pulled charges are recorded and their check comes due
      Then no comparison is requested
      And no comparison is recorded as having given up
      # The comparison reads the summary store, which is optional. Neither
      # failure mode is acceptable: hundreds of comparisons dying five
      # attempts at a time fills the record with noise that hides a real
      # failure, and a comparison that reports success without reading
      # anything is a watchdog that has been taught to say "fine".

    @unit
    Scenario: A deployment that can compare but holds no summary mounts no check
      Given a deployment configured to compare days but with no cost summary store
      Then the check is not mounted at all
      # The comparer and the summary are two separate pieces of configuration,
      # so a deployment can hold either one alone. Arming on the comparer by
      # itself is the same broken deployment as the scenario above, reached
      # from the other side: days compared against a summary nobody writes.

  Rule: A check that was missed still happens

    @integration
    Scenario: A check whose moment passed with nothing running fires once afterwards
      Given a check's moment passed with nothing running to answer it
      When the machinery that answers checks runs again
      Then the check is answered exactly once
      And the marked days are compared
      And no extra comparison is asked for per slot that went by in between
      # The reminder lives in the database, not in the queue, so losing the
      # queue loses nothing. One catch-up rather than one per missed night:
      # the marked days are the same days either way, so replaying the slots
      # would only compare them repeatedly.

  Rule: Silence has to be distinguishable from breakage

    # The failure this rule exists for: the wiring between charges and checks
    # breaks, nothing is ever marked, nothing is ever compared — and the
    # numbers we watch read exactly as they do for an organization that spent
    # nothing, which the rule above declares correct and desirable. The
    # nightly job left a row per organization per night whether or not
    # anything happened, so its absence was visible for free. This design
    # gives that up on purpose and has to buy the signal back.

    @unit
    Scenario: An organization holding marked days always has a check armed
      Given any organization with at least one day marked as needing a check
      Then that organization has a check armed
      # The cheapest canary available, because it is an invariant rather than
      # a threshold: marked days with nothing armed to answer them is a state
      # the design says cannot occur, so anything finding one has found the
      # break rather than a quiet week.

    @integration
    Scenario: A check that is overdue is visible without anyone knowing to look
      Given a check whose moment passed and which has not been answered
      When the state of checks is read
      Then that check is reported as overdue
      # Leaning on what the process substrate already surfaces rather than
      # inventing a second one. It covers a check that was armed and never
      # ran; it does not cover arming never happening at all, which the
      # scenario above is for.

  Rule: What this deliberately does not do

    # Stated as behaviour rather than left to be assumed, because each of
    # these is a plausible next step that someone would otherwise add
    # quietly, and each changes what the numbers mean.
    #
    #  * No self-heal. Finding drift never rewrites the summary. The summary
    #    is a consequence of the event history; a repair that only reaches
    #    storage is undone by the next rebuild, and one that reaches the
    #    history is a restatement somebody has to stand behind.
    #  * No backfill. A day that received no charge and no correction is
    #    never checked, however long ago it was last checked. Checking every
    #    day forever is the nightly job with more steps.
    #  * No alerting. Drift is counted and logged. Nothing pages anyone; that
    #    was true of the nightly job too and is not changed here.
    #  * No per-project split. The check is armed once per organization, not
    #    once per project or per bill, because the comparison reads a whole
    #    organization's day.
    #  * No catch-up at the cutover. An organization that was being checked
    #    nightly before this shipped is not checked again until its next
    #    charge or correction arrives. For a source that pulls daily that is
    #    a gap of hours; for one that was switched off it is forever, and
    #    what is lost is the checking of days nothing has touched since —
    #    which the second bullet already says is not checked anyway.
    #  * No guarantee past the point the record of a comparison is kept.
    #    A repeat of one check slot is recognised as a repeat for as long as
    #    the record of the first one survives; a delivery arriving after that
    #    compares the day a second time. The scenario below bounds what that
    #    costs.

    @integration
    Scenario: Finding drift leaves the summary exactly as it was
      Given a day's summary no longer matches its recorded charges
      When the comparison for that day runs
      Then the stored summary is unchanged
      And no correcting event is recorded

    @integration
    Scenario: A quiet day is never re-checked on its own
      Given a day that was compared and has received nothing since
      When later checks come due
      Then that day is not compared again

    @integration
    Scenario: Comparing a day twice over changes nothing that is stored
      Given a day that has already been compared
      When it is compared a second time
      Then the stored summary is unchanged
      And the second comparison reports the same finding as the first
      # What bounds the repeat case above. A comparison only reads, so the
      # cost of running one twice is a count and a log line, never a figure.
      # Asserted so that a future change which gives the comparison something
      # to write has to come back and answer this.
