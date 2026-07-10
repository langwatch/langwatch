Feature: Metering cutover bills forward only
  # ADR-039 rollout step 3 / Invariant I8. Organizations whose event metering
  # turns on mid-month (the drifted cohort) must never be billed for events
  # that occurred before the cutover. The reporting checkpoint defaults to 0,
  # which would bill the entire month-to-date on first run — cutover seeds it.

  As the billing operations team
  I want newly-metered organizations billed only from the cutover moment
  So that no customer receives retroactive charges for previously un-metered usage

  @integration
  Scenario: A seeded checkpoint bills only post-cutover events
    Given an organization newly included in the metering population mid-month
    And its reporting checkpoint was seeded to its month-to-date total of 10000 events
    And the organization records 500 more events after the cutover
    When the usage report runs for the current billing month
    Then exactly 500 events are reported to Stripe

  @integration
  Scenario: An unseeded newly-metered organization would bill the full month-to-date
    Given an organization newly included in the metering population mid-month
    And its reporting checkpoint is absent
    When the usage report runs for the current billing month
    Then the report would include events from before the cutover
    # This scenario documents WHY seeding exists; it guards the seeding
    # requirement by proving the default behavior is retroactive.

  @unit
  Scenario: Seeding never lowers an existing checkpoint
    Given an organization with an existing reporting checkpoint of 12000 events
    When checkpoint seeding runs with a month-to-date total of 10000 events
    Then the checkpoint remains 12000

  @unit
  Scenario: Seeding is idempotent
    Given an organization whose checkpoint was already seeded at cutover
    When checkpoint seeding runs again with the same cohort
    Then the checkpoint value is unchanged
