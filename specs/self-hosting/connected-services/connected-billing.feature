Feature: Billing a connected self-hosted customer
  A connected customer pays by invoice. Hosted usage draws down a prepaid commit
  at list rates, and the commit expires with the term. Anything past the commit
  is only possible when the contract enables on-demand overage, and is invoiced
  quarterly in arrears. Seats added mid-term are invoiced on their own one-off
  invoice, prorated to the end of the term.

  The cap the customer sees is enforced by LangWatch's own budget in real time.
  The payment provider's credit balance is settled when an invoice is finalized,
  so it is never used to decide whether a request may run. Invoices are chased
  by finance by hand; the hard stops are the license end date and revocation.

  As LangWatch finance
  I want onboarding, drawdown, overage and seat changes to be repeatable and safe to retry
  So that every invoice can be explained line by line and no customer is charged twice

  Background:
    Given LangWatch Cloud with billing configured in test mode
    And customer organization "ACME" marked as a self-hosted customer

  # ============================================================================
  # Onboarding
  # ============================================================================

  @unit
  Scenario: Onboarding creates an invoice customer
    When an operator onboards "ACME" with a term of one year, a commit of 1000 USD and payment by bank transfer
    Then a billing customer exists for "ACME" that is invoiced rather than charged, with 30 days to pay
    And bank transfer is offered on its invoices

  @unit
  Scenario: Onboarding subscribes the customer to metered usage invoiced quarterly
    When an operator onboards "ACME"
    Then "ACME" has a subscription whose only item is metered hosted usage
    And it is invoiced every three months from the start of the term

  @unit
  Scenario: The prepaid commit becomes a credit that only applies to metered usage
    When an operator onboards "ACME" with a commit of 1000 USD
    Then "ACME" holds a paid credit of 1000 USD that applies to metered usage only

  @unit
  Scenario: The commit is charged on the annual invoice, the credit charges nothing
    When an operator onboards "ACME" with 50 seats and a commit of 1000 USD
    Then the annual one-off invoice for "ACME" has a line for the seats and a line for the 1000 USD commit
    And creating the credit does not create an invoice of its own

  @unit
  Scenario: The usage subscription is in USD whatever the seat currency
    When an operator onboards "ACME" with seats invoiced in EUR
    Then the annual invoice is in EUR
    And the usage subscription and the credit are in USD

  @unit
  Scenario: The commit credit outlives the last invoice of the term
    When an operator onboards "ACME" with a term ending on a given day
    Then the credit expires after the invoice for the last quarter of the term has been finalized
    And use after the end of the term is stopped by the budget and the license, not by the credit

  @unit
  Scenario: The organization budget equals the commit
    When an operator onboards "ACME" with a commit of 1000 USD
    Then "ACME" has an organization budget of 1000 USD that blocks when spent
    And the budget runs for the contract term rather than a calendar month

  @unit
  Scenario: Onboarding twice does not create anything twice
    Given "ACME" was already onboarded
    When an operator runs onboarding for "ACME" again with the same terms
    Then there is still one billing customer, one subscription, one credit and one budget

  @unit
  Scenario: Onboarding that fails halfway can be resumed
    Given onboarding created the billing customer and then failed
    When an operator runs onboarding for "ACME" again
    Then the existing billing customer is reused and the remaining steps complete

  @unit
  Scenario: Onboarding without a commit gives no hosted usage
    When an operator onboards "ACME" with no commit and overage off
    Then "ACME" has a budget of zero
    And hosted services answer 402 until a commit is added

  @unit
  Scenario: A customer who cannot pay through a virtual bank account is invoiced without one
    When an operator onboards "ACME" with payment by wire outside the payment provider
    Then its invoices are sent without bank transfer instructions from the payment provider
    And finance can mark them paid once the wire arrives

  @unit
  Scenario: Onboarding is refused outside LangWatch Cloud
    Given a deployment that is not LangWatch Cloud
    When onboarding is attempted
    Then it is refused because billing is only available on LangWatch Cloud

  # ============================================================================
  # Adding commit mid-term
  # ============================================================================

  @unit
  Scenario: Adding commit raises the credit and the budget together
    Given "ACME" was onboarded with a commit of 1000 USD
    When an operator adds a commit of 500 USD
    Then "ACME" holds a second paid credit of 500 USD
    And its budget is 1500 USD

  # ============================================================================
  # Renewal
  # ============================================================================

  @unit
  Scenario: Renewal keeps the one usage subscription and resets the budget
    Given "ACME" was onboarded for a first term
    When an operator renews "ACME" for a second term with a commit of 2000 USD
    Then "ACME" still has one usage subscription
    And its budget is reset and set to 2000 USD for the new term

  @unit
  Scenario: The renewal credit waits for the last usage invoice of the old term
    Given the last usage invoice of the old term has not been finalized
    When an operator renews "ACME"
    Then the credit for the new term is not created yet
    And it is created once that invoice is finalized

  @unit
  Scenario: Overage from the old term is not absorbed by the new credit
    Given "ACME" ended its first term with 80 USD of overage
    When the renewal completes
    Then the 80 USD is owed on the last invoice of the old term
    And the new credit is whole

  # ============================================================================
  # Payment
  # ============================================================================

  @unit
  Scenario: An invoice shows the payment instructions that fit the customer
    Given "ACME" pays by wire to the LangWatch bank account
    When an invoice is created for "ACME"
    Then it shows the LangWatch bank details and no payment provider bank transfer instructions

  @integration
  Scenario: Finance marks an invoice paid out of band from the backoffice
    Given an open invoice for "ACME" that was paid by wire
    When an operator marks it paid out of band
    Then the invoice is paid without a charge through the payment provider
    And the audit log records who marked it and when

  # ============================================================================
  # Usage metering
  # ============================================================================

  @unit
  Scenario: Hosted usage of a connected customer reaches its metered subscription
    Given "ACME" was onboarded
    And hosted spend was recorded under "ACME"
    When usage is reported for the month
    Then the spend is reported to the hosted usage meter for the billing customer of "ACME"

  @integration
  Scenario: A connected customer is not skipped for lacking a Cloud plan
    Given "ACME" is a self-hosted customer with no LangWatch Cloud plan
    And hosted spend was recorded under "ACME"
    When usage is reported for the month
    Then "ACME" is not skipped as an organization that is not billed for usage

  @integration
  Scenario: An organization that is neither usage billed nor a self-hosted customer is still skipped
    Given an organization on a plan that is not billed for usage and that is not a self-hosted customer
    When usage is reported for the month
    Then it is skipped as before

  @unit
  Scenario: Usage older than the meter accepts is not sent with a stale timestamp
    Given hosted spend from more than 35 days ago that was never reported
    When usage is reported
    Then the meter event carries a timestamp the meter accepts
    And the amount is still reported in full

  @unit
  Scenario: Reporting the same usage twice does not double it
    Given usage for the month was already reported
    When usage is reported for the month again with no new spend
    Then nothing more is sent to the meter

  @unit
  Scenario: Usage past the prepaid commit never reaches the invoice
    Given "ACME" has a commit of 500 USD and on-demand overage off
    And the spend ledger shows 500.80 USD, because the gateway stopped it a few cents late
    When usage is reported
    Then exactly 500 USD reaches the meter
    And the credit covers the quarterly invoice in full

  # ============================================================================
  # Changing seats mid-term
  # ============================================================================

  @unit
  Scenario: Seats added mid-term are invoiced prorated to the end of the term
    Given "ACME" is licensed for 50 seats at 600 USD per seat per year, for a term of 365 days
    And an operator raises the license to 58 seats with 182 days of the term left
    When the added seats are invoiced
    Then a one-off invoice for 8 added seats is created for "ACME"
    And each seat is charged 600 USD times 182 over 365, rounded to the cent
    And the line carries the unit amount and the quantity, so they multiply back to the total

  @unit
  Scenario: The seat invoice is its own invoice in the currency of the seat contract
    Given "ACME" pays for seats in EUR and for hosted usage in USD
    When the added seats are invoiced
    Then a one-off invoice in EUR is created for the added seats
    And the USD usage subscription is untouched

  @unit
  Scenario: Seats that went down are not credited back mid-term
    Given "ACME" is licensed for 50 seats
    When an operator lowers the license to 40 seats
    Then no invoice and no credit is created

  @unit
  Scenario: Changing the seats twice for one reissued license invoices once
    Given the added seats of a reissued license were already invoiced
    When the same change is run again
    Then no second invoice is created

  @unit
  Scenario: A seat invoice that failed at the payment provider is retried without doubling
    Given the seat change recorded its intent and the payment provider call then failed
    When the daily billing tick runs
    Then the invoice is created once
    And the backoffice showed the change as pending until then

  @unit
  Scenario: Seat invoices are never paid from the usage commit
    Given "ACME" has unspent usage commit
    When a seat invoice is finalized
    Then it is owed in full
    And the usage commit is untouched by it

  @unit
  Scenario: A customer with no billing account gets no seat invoice from LangWatch
    Given "ACME" was never onboarded for billing
    When an operator raises its seats
    Then the license is reissued
    And the operator is told finance invoices the added seats by hand

  # ============================================================================
  # Monthly statement
  # ============================================================================

  @unit
  Scenario: The billing contact receives a monthly usage statement
    Given "ACME" used hosted services during the month
    When the monthly statement runs
    Then the billing contact of "ACME" receives the spend for the month by service, the commit drawn down so far, the credit remaining and the seats licensed and reported

  @unit
  Scenario: A month with no usage sends no statement
    Given "ACME" used no hosted services during the month
    When the monthly statement runs
    Then no statement is sent to "ACME"

  @unit
  Scenario: The statement is sent once per month
    Given the statement for the month was already sent to "ACME"
    When the monthly statement runs again
    Then no second statement is sent

  # ============================================================================
  # Backoffice
  # ============================================================================

  @integration
  Scenario: The backoffice shows the commercial state of each connected customer
    Given "ACME" was onboarded, has used hosted services and has synced
    When an operator opens the customer in the backoffice
    Then they see the commit, the amount drawn down, the overage, the seats licensed and the seats reported, the time of the last sync and the open invoices

  @unit
  Scenario: The backoffice says so when live spend cannot be read
    Given the spend ledger cannot be read
    When an operator opens the customer in the backoffice
    Then the drawn down amount is shown as unavailable rather than zero
