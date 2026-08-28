@governance @cost
Feature: One cost screen, three honest lanes
  Wave 1 shows what the provider billed, what the gateway metered, and a
  seat lane — side by side, each labeled for what it is, never summed
  into one figure. Seat DATA is out of this wave: seat licence ingestion
  and the dated price list ship in a separate PR (owner: Sergio). Until
  that lands, the seat lane renders as an honest empty state — labeled,
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
    When a permitted viewer opens the cost screen
    Then billed and gateway amounts appear as separately labeled figures
    And each lane shows the amount from its own lane's data, never the other lane's
    # "Never summed into one figure" is a universal negative no test can
    # prove; ADR-128 assigns it to the code-review gate in wave 1. This
    # scenario asserts the positive: separate lanes, separate labels, and
    # a cross-lane check — the billed number must not appear under the
    # gateway label or vice versa. "Matches its own source" end to end is
    # a datastore-lane concern covered by the rollup spec, not this
    # component test.

  @integration
  Scenario: The seat lane is an honest hole until seat data ships
    # Seat ingestion and pricing arrive in a separate PR. The lane still
    # renders so the screen's shape is complete, but it must say it has
    # no data — a silent zero here would be a lie about money.
    # LangWatch subscription seats (Subscription.maxMembers) are NOT this
    # lane's data and must not be wired in as a stand-in.
    # The Given carries the condition: when the seats PR ships, it flips
    # this state with a data-present scenario instead of deleting this one.
    Given seat licence data has not been ingested for this organization
    When a permitted viewer opens the cost screen
    Then the seat lane is present and labeled
    And the seat lane states that seat data is not yet available
    And the seat lane displays no amount at all
    # "No amount at all" — not "no zero": formatters emit "$0.00", "$0",
    # "0.00 USD" depending on locale/currency, and a zero can hide in an
    # aria-label. The only honest assertion is that the lane contains no
    # rendered money value whatsoever.

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
    Given a member holding the governance cost permission on a different organization
    When they query this organization's cost data
    Then the query is refused

  @integration
  Scenario: The screen stays behind its release flag
    # ADR-128 names two flags: pulled-cost recording and the cost screen.
    # This scenario covers the screen flag; recording may be on while the
    # screen stays hidden. The actor HOLDS the permission — otherwise the
    # permission guard denies anyway and the test passes with the flag on,
    # proving nothing about the flag.
    Given the cost screen release flag is off for the organization
    And a viewer holding the governance cost permission
    When they open the place the screen would live
    Then the not-found screen is shown in its place

  @integration
  Scenario: A failed cost read never renders as zero
    # The exact failure the feature forbids: a `?? 0` on a failed or null
    # read fabricates a zero where there is no data. An error is honest;
    # a zero is a statement about money.
    Given the cost data read fails for this organization
    When a permitted viewer opens the cost screen
    Then an error state is shown
    And no lane displays a zero amount

  @integration
  Scenario: A refund-heavy billed day renders negative as reported
    # Render-only in wave 1: the screen shows what the bill says, without
    # interpretation. (Deeper negative-day semantics are stamped wave 2 in
    # the ADR; flagged to the ADR owner as a deliberate scope call.)
    Given a billed day whose total is negative
    When a permitted viewer opens the cost screen
    Then the billed lane shows the negative amount as reported
