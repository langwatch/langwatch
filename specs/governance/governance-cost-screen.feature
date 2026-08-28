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
    And each lane's total matches its own source
    # "Never summed into one figure" is a universal negative no test can
    # prove; ADR-128 assigns it to the code-review gate in wave 1. This
    # scenario asserts the positive: separate lanes, separate labels, each
    # total traceable to its own lane's data.

  @integration
  Scenario: The seat lane is an honest hole until seat data ships
    # Seat ingestion and pricing arrive in a separate PR. The lane still
    # renders so the screen's shape is complete, but it must say it has
    # no data — a silent zero here would be a lie about money.
    # LangWatch subscription seats (Subscription.maxMembers) are NOT this
    # lane's data and must not be wired in as a stand-in.
    When a permitted viewer opens the cost screen
    Then the seat lane is present and labeled
    And it states that seat data is not yet available
    And it does not show a zero amount

  @integration
  Scenario: Viewing requires the organization-scoped governance cost permission
    Given a member without the governance cost permission on this organization
    # The permission is ORG-scoped (registry key governanceCost:view —
    # camelCase; underscore form is not a legal registry key). Holding it
    # on another organization, or holding project/team permissions here,
    # must not open this screen.
    When they request the cost data
    Then the request is denied

  @integration
  Scenario: The screen stays behind its release flag
    # ADR-128 names two flags: pulled-cost recording and the cost screen.
    # This scenario covers the screen flag; recording may be on while the
    # screen stays hidden.
    Given the cost screen release flag is off for the organization
    When a member opens the place the screen would live
    Then the cost screen is not shown

  @integration
  Scenario: A refund-heavy billed day renders negative as reported
    # Render-only in wave 1: the screen shows what the bill says, without
    # interpretation. (Deeper negative-day semantics are stamped wave 2 in
    # the ADR; flagged to the ADR owner as a deliberate scope call.)
    Given a billed day whose total is negative
    When the billed lane is read
    Then the negative amount is shown as reported
