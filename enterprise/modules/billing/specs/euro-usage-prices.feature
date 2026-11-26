Feature: Euro Growth subscriptions are charged for Instant Evals and PII redaction usage

  Both usage meters count dollars. A Stripe subscription has one currency, so a euro Growth
  subscription could never take the dollar price lines and its usage was never charged. Each
  meter now carries two prices: the dollar one, and a euro one at 0.85 euros per dollar of usage
  (the seat ratio, EUR 29 / USD 34). One meter, so usage is never split; a fixed ratio, not a
  live exchange rate, so an invoice reads the same every month. The price is picked from the
  currency Stripe holds the customer in, never from the organization's own currency field,
  because the two can disagree. ADR-174 decision 19 and ADR-201 decision 11, revised 2026-11-26.

  Rule: A Growth checkout carries the usage prices in the subscription's currency

    @unit
    Scenario: A Growth checkout in euros carries the euro Instant Evals and PII redaction prices
      Given a Stripe mode where the euro Instant Evals and PII redaction prices are provisioned
      When a Growth checkout in euros is built
      Then it carries the GROWTH_INSTANT_EVAL_EUR and GROWTH_PII_REDACTION_EUR lines with no quantity
      And it carries no dollar usage line

    @unit
    Scenario: A Growth checkout in dollars keeps the dollar Instant Evals and PII redaction prices
      Given a Stripe mode where both currencies' usage prices are provisioned
      When a Growth checkout in dollars is built
      Then it carries the GROWTH_INSTANT_EVAL_USD and GROWTH_PII_REDACTION_USD lines
      And it carries no euro usage line

    @unit
    Scenario: A Growth checkout in euros works where the euro usage prices are not provisioned
      Given a Stripe mode that maps only the dollar usage prices
      When a Growth checkout in euros is built
      Then it carries the seat and events items only

    @unit
    Scenario: The checkout's usage prices follow the Stripe customer's currency, not the organization's
      Given an organization whose own currency is euros
      And its Stripe customer is already fixed to dollars
      When a Growth checkout is opened for it in euros
      Then the checkout is built in dollars with the dollar Instant Evals and PII redaction prices

  Rule: The monthly report counts either currency's price as the meter's price

    @unit
    Scenario: The report counts a subscription carrying the euro Instant Evals price as priced
      Given an organization whose euro Growth subscription has the GROWTH_INSTANT_EVAL_EUR line
      And Instant Eval spend of 0.30 dollars this month
      When the month is reported
      Then the subscription read asks for either the dollar or the euro Instant Evals price
      And the Instant Eval meter event's value is 0.3

    @unit
    Scenario: The report counts a subscription carrying the euro PII redaction price as priced
      Given an organization whose euro Growth subscription has the GROWTH_PII_REDACTION_EUR line
      And PII redaction spend this month
      When the month is reported
      Then the subscription read asks for either the dollar or the euro PII redaction price
      And the PII redaction meter event is sent

    @unit
    Scenario: A line on either currency's price counts as the meter's price
      Given a customer's invoiced subscriptions as Stripe lists them in one read
      When one of them has a line on the euro Instant Evals price, by id, lookup key or langwatch_key
      Then the customer carries the Instant Evals price
      And a mode that maps neither price never carries it

    @integration
    Scenario: A euro subscription's Instant Evals usage is invoiced at 0.85 euros per dollar
      Given a euro Growth subscription in the payment simulator with the euro Instant Evals price at 85 euro cents per meter unit
      And Instant Eval spend of 0.30 dollars this month
      When the month is reported against the payment simulator
      Then the simulator holds 0.3 of Instant Eval usage for that customer, priced at 85 euro cents per unit

    @integration
    Scenario: An organization whose currency disagrees with its Stripe subscription is reported on the subscription's price
      Given an organization whose own currency is euros
      And its Growth subscription in the payment simulator is in dollars with the dollar Instant Evals price
      When the month is reported against the payment simulator
      Then its Instant Eval usage reaches the simulator on the dollar price

    @unit
    Scenario: A euro usage price is metered on its dollar meter in the payment simulator
      Given a catalogue that maps the euro Instant Evals and PII redaction prices
      When the payment simulator seeds it
      Then each euro price is metered on the dollar meter its dollar price bills

  Rule: The euro price is a fixed ratio of the dollar price

    @unit
    Scenario: A mapped euro usage price costs 0.85 of its dollar price
      Given the Stripe catalogue in either mode
      When a euro usage price is mapped beside its dollar price
      Then it is a monthly euro price whose unit amount is 0.85 of the dollar price's
