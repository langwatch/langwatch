Feature: Enterprise billing compatibility

  @unit
  Scenario: Resolve a portable SaaS plan
    Given Billing receives an active subscription and explicit plan overrides
    When the plan service resolves the organization's plan
    Then it returns the same plan type and limits as the legacy Billing module

  @unit
  Scenario: Report metered usage through an injected provider
    Given a Billing meter and Stripe adapter are composed
    When usage is reported for an organization and billing month
    Then the same idempotency key, event value, and failure semantics are used

  @unit
  Scenario: Keep browser pricing backend-free
    Given the Billing web package renders or formats pricing
    When its dependency graph is inspected
    Then it imports no Stripe SDK, Prisma client, server package, or application source

  Rule: A billing month names one whole calendar month in UTC

    The month a usage figure is billed under is a UTC calendar month, not a
    window measured from the reader's own clock: two organizations reading the
    same minute from different time zones must be charged the same month.

    @unit
    Scenario: The billing month is the UTC calendar month the moment falls in
      Given a moment late on the last day of a month in UTC
      When the billing month is taken
      Then it names that month, and not the next one a later time zone has entered

    @unit
    Scenario: The previous billing month walks back across a year end
      Given a moment in January
      When the previous billing month is taken
      Then it names December of the year before

    @unit
    Scenario: A month is asked for as a half-open range ending at the next month
      Given a billing month
      When its date range is taken
      Then it starts at the first instant of that month and ends at the first instant of the next
      And a December range ends in January of the following year

  Rule: An organization is not alerted twice inside its cooldown

    The database's own window is authoritative. This is the near-term damper in
    front of it, so a burst of usage inside one minute produces one alert.

    @unit
    Scenario: A key taken once is refused until its cooldown has run
      Given an alert cooldown of a fixed length
      When the same organization's key is claimed twice inside that length
      Then the second claim is refused

    @unit
    Scenario: The cooldown ends the instant it expires, not a moment before
      Given an organization's key claimed at a known moment
      When the cooldown length has elapsed exactly
      Then the key is free again

    @unit
    Scenario: Clearing a cooldown lets the next alert through immediately
      Given an organization's key inside its cooldown
      When the cooldown is cleared
      Then the next claim succeeds
