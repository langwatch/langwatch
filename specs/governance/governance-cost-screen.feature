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
  visibly awaiting data, never a fabricated zero. LangWatch's own
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
