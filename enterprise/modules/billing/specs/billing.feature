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

  @unit
  Scenario: The automation ceiling rises with each self-serve rung
    Given the self-serve ladder of Free, Launch, Accelerate and Growth
    When their automation daily dispatch ceilings are compared
    Then each rung's ceiling is strictly higher than the rung below it

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

  @unit
  Scenario: Billing answers a Cloud organization's active subscription plan
    Given LangWatch Cloud and an organization with an active paid subscription
    When entitlement asks billing for the organization's subscription plan
    Then the subscription's plan answers
    And an operator impersonating a customer gets the adding limitations lifted

  @unit
  Scenario: Billable events are counted per named project
    Given an organization metered in events whose second project sent nothing this month
    When its billable events are counted for both projects
    Then the first project reports its events and the second reports zero

  @unit
  Scenario: LangWatch Cloud detects the currency a reader's prices are shown in
    Given LangWatch Cloud and a request that names no country
    When the plans page asks which currency to show
    Then billing answers the default currency with no country

  @unit
  Scenario: A self-hosted deployment serves no currency detection
    Given a self-hosted deployment, where main mounted an empty currency router
    When the plans page asks which currency to show
    Then billing refuses with the handled not_found, the 404 main's missing procedure answered

  @unit
  Scenario: An impersonated back-office call with no impersonator id is refused
    Given an operator impersonating a customer, on a door that names the impersonator by address only
    When the connected-billing back office is called
    Then billing is asked as nobody and refuses with the shared not-found
    And it is never asked as the impersonated customer

  @unit
  Scenario: Someone who is not staff is answered not-found by the connected-billing door
    Given a caller who holds no platform operator permission
    When they read or write a customer's connected billing
    Then the platform door answers not-found before billing is asked
    And an anonymous caller is answered 401

  @unit
  Scenario: A view-only operator reads the billing overview but is refused on every billing write
    Given a platform operator holding ops:view and not ops:manage
    When they read a customer's connected-billing overview
    Then the overview answers
    And onboard, add commit, renew, complete renewal and mark paid out of band are each refused with permission_denied

  @unit
  Scenario: A Stripe customer reads alike over the provider and its memory twin
    Given the Stripe customers channel over the provider and over its memory twin
    When a customer is created, read back, deleted and read again
    Then each tier answers the created customer with no fixed currency, then answers it deleted
    And each tier answers a customer whose currency is fixed with that currency
    And each tier refuses a read of a customer it never held with resource_missing

  @unit
  Scenario: A Stripe subscription changes alike over the provider and its memory twin
    Given the Stripe subscriptions channel over the provider and over its memory twin, each holding an active subscription
    When the subscription is read, updated and cancelled, an invoice preview is asked for, and a checkout and a billing portal session are opened
    Then each tier answers the subscription with its items, then answers it cancelled
    And each tier cancels a superseded subscription with proration when asked to prorate
    And each tier answers the preview and each session with a url
    And each tier answers a completed checkout session's line items with their quantities
    And each tier refuses a read of a subscription it never held with resource_missing
    And each tier refuses the line items of a checkout session it never held with resource_missing

  @unit
  Scenario: A Stripe customer's invoices list alike over the provider and its memory twin
    Given the Stripe invoices channel over the provider and over its memory twin, each holding five invoices for one customer and one for another
    When the customer's invoices are listed with a limit of four
    Then each tier answers that customer's four newest invoices, newest first
    And each tier answers an empty list for a customer with no invoices
    And each tier passes a refused listing through as the provider's own error
