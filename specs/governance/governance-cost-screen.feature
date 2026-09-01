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
    # ADR-128 4a. A source that has stopped pulling is not asked about
    # anything, so it reports no spend, so the lanes fall. On screen that is
    # indistinguishable from a cheap month, and a reader who takes an outage
    # for a saving is worse off than one with no cost screen at all. The
    # source pages already carry this line; only someone already suspicious
    # goes there.

    @integration
    Scenario: The cost screen says where its numbers stop being complete
      Given a contributing source that has stopped pulling
      When a permitted viewer opens the cost screen
      Then the screen names that source and the day its data stops
      And the lanes are still shown
      # The figures are caveated, not withdrawn. What was pulled before the
      # outage is still the truth about those days.

    @integration
    Scenario: A screen whose sources are all pulling carries no outage notice
      Given every contributing source pulling successfully
      When a permitted viewer opens the cost screen
      Then the screen carries no outage notice
      # A caveat on whole figures teaches the reader to ignore caveats.

    @unit
    Scenario: The gap is dated from the first source that fell over
      Given two contributing sources that stopped pulling on different days
      When the cost summary is read
      Then the gap is dated from the earlier of the two
      # The totals stopped being whole when the first one broke, not the last.

    @unit
    Scenario: A source nobody asked to run is not reported as an outage
      Given a disabled source whose last runs failed before it was switched off
      And a source that has never pulled successfully
      When the cost summary is read
      Then neither is reported as having stopped pulling
      # A disabled source is not failing to run, it is doing what an admin
      # chose. One that never succeeded has no "since" to name, and its
      # awaiting-first-event badge already says so.

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
