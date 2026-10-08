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
    Then each tier answers the subscription in billing's own shape with its items, then answers it cancelled
    And each tier cancels a superseded subscription with proration when asked to prorate
    And each tier answers the preview and each session with a url
    And each tier answers a completed checkout session's line items with their quantities
    And each tier refuses a read of a subscription it never held with resource_missing
    And each tier refuses the line items of a checkout session it never held with resource_missing

  @unit
  Scenario: Billing's subscription shapes reach Stripe as the same requests
    Given the Stripe subscriptions channel over the provider
    When a subscription is read, and a seat change, a billing threshold, a preview and a checkout are sent in billing's own shapes
    Then the subscription is answered with each item's price, unit amount and interval, its cancellation instant and its billing threshold
    And the change, the threshold and the preview reach Stripe as the same parameters the services sent before
    And the preview is answered from the invoice's total and amount due, however many lines it carries
    And every checkout is raised as a subscription with automatic tax, a required billing address, tax id collection, the customer's address and name updated, and adaptive pricing off
    And a completed checkout's line items are answered with their price and quantity, a line with no price answered with none

  @unit
  Scenario: A Stripe customer's invoices list alike over the provider and its memory twin
    Given the Stripe invoices channel over the provider and over its memory twin, each holding five invoices for one customer and one for another
    When the customer's invoices are listed with a limit of four
    Then each tier answers that customer's four newest invoices in billing's own shape, newest first
    And each tier answers an empty list for a customer with no invoices
    And each tier passes a refused listing through as the provider's own error
    And the provider's invoice is answered with its number, amount due, status and links, a customer held as an object answered by its id

  @unit
  Scenario: Stripe prices page alike over the provider and its memory twin
    Given the Stripe prices channel over the provider and over its memory twin, each holding three prices
    When the prices are listed two to a page, the second page starting after the first page's last price
    Then each tier answers two prices in billing's price shape and says more remain, then the third and says none remain
    And each tier maps a product held as an object to its id and a one-time price to no recurrence
    And each tier passes a refused listing through as the provider's own error

  @unit
  Scenario: Stripe usage meters record and summarise alike over the provider and its memory twin
    Given the Stripe meters channel over the provider and over its memory twin, each holding two meters and one meter's summaries for a customer
    When a meter event is recorded, the meters are listed one to a page, and a customer's summaries are read for a window
    Then each tier records the event with its name, customer, value, identifier and timestamp
    And each tier answers each meter with its event name and status, a page at a time
    And each tier answers that customer's summarised values for the window and none for another customer
    And each tier refuses a second event with the same identifier with resource_already_exists
    And each tier passes a refused meter event through as the provider's own error

  # Round 37 D3 (Alex, 2026-10-08): billing records the audit fact; audit-log writes the row.
  @unit
  Scenario: A platform operator's billing command records an audit fact for audit-log
    Given a platform operator on LangWatch Cloud
    When the operator reads a connected customer's billing overview
    Then billing records an audit fact naming the operator, the action, its arguments and the organization
    And the fact carries a fresh audit id, so a redelivery writes one row

  # Round 37 D5, R40 (Alex, 2026-10-07): billing reads gateway's spend ledger and project's
  # projects through the owners' declared shares, never a copy and never their *Api.
  Rule: Billing reads gateway's spend and project's projects through declared shares

    @unit
    Scenario: Billing sums one request type's confirmed spend from gateway's shared ledger
      Given gateway's ledger holds confirmed, pending and failed spend of several request types
      When billing sums one request type's spend for an organization's projects inside a window
      Then only that request type's confirmed spend inside the window is counted, in nano-USD
      And no projects sum to zero without a read

    @unit
    Scenario: Billing's spend read binds exactly the organization's projects
      When billing sums spend for an organization's projects
      Then it reads gateway_spend at its latest version, one bound tenant per project
      And the ClickHouse tenant guard admits the statement

    @unit
    Scenario: Billing lists an organization's projects from project's shared table
      Given an organization with live, archived and governance projects
      Then its spend tenants are every live project, governance included
      And its usage warning names every project but governance ones, archived included, by name

  # Alex, 2026-10-08 (R42, round 46 D-b): billing's writes to organisation rows are facts organization
  # applies; the Stripe customer-id claim alone stays synchronous, as a named write exception.
  Rule: Billing records its writes to organisation rows as facts, and organization applies them

    @unit
    Scenario: Organization stamps the plan-limit alert from billing's fact
      Given billing sent an organization's plan-limit alert
      When organization applies billing's plan-limit-alert-sent fact
      Then the organization's sentPlanLimitAlert is the instant billing recorded
      And billing wrote no organisation row itself

    @unit
    Scenario: Organization sets the checkout currency and the pricing model from billing's facts
      When organization applies billing's currency-selected fact for EUR
      And organization applies billing's pricing-model-changed fact for SEAT_EVENT
      Then the organization's currency is EUR and its pricing model is SEAT_EVENT

    @unit
    Scenario: Organization opens a paid seat checkout's held invitations from billing's fact
      Given an organization holds payment-pending invitations for a seat checkout
      When organization applies billing's seat-checkout-paid fact for that checkout
      Then those invitations are opened and the invitations of other checkouts are not

    @unit
    Scenario: Organization cancels the held invitations of abandoned seat checkouts from billing's fact
      Given an organization holds payment-pending invitations for two abandoned checkouts
      When organization applies billing's seat-checkouts-abandoned fact naming both
      Then the invitations of both checkouts are cancelled

    @unit
    Scenario: A redelivered billing fact leaves the organisation as one delivery did
      Given organization applied each of billing's organisation-row facts once
      When every fact is delivered again
      Then the organisation's columns and invitations are unchanged by the second delivery

    @unit
    Scenario: A plan-limit alert inside the apply window is not sent twice
      Given billing sent an organization's plan-limit alert and recorded the fact
      And organization has not applied the fact yet
      When the organization reaches its plan limit again in the same process
      Then billing's 30-day damper refuses the second alert without reading the stamp
      # Across processes the accepted window is the seconds before organization applies the fact.

    @unit
    Scenario: A billing write whose fact cannot be recorded fails its caller
      Given billing's lifecycle senders refuse the fact
      When checkout completion selects a currency for the organization
      Then the Stripe delivery fails so Stripe delivers it again

    @unit
    Scenario: The tiered free-plan move records a pricing-model fact for each organisation it moves
      Given TIERED organisations with no subscription, more than one page of them
      When the tiered-free-to-seat-event task runs with --execute
      Then it records one pricing-model-changed fact for SEAT_EVENT per organisation, paging by cursor
      And it writes no organisation row itself

    @unit
    Scenario: The Stripe customer-id claim stays a synchronous compare-and-set
      Given two checkouts for one organization that holds no Stripe customer id
      When both claim a different customer id at once
      Then exactly one claim wins and the other reads the winner's id back
      And the claim is billing's one admitted write on organization's shared table
