Feature: Checkout volume is measured

  A broken upgrade path throws nothing and logs nothing: the button is missing,
  or it leads nowhere, or the server refuses a caller who should be allowed.
  The one trace it leaves is that checkouts stop. Billing counts every checkout
  it starts, refuses and completes, so an alert can notice the silence.

  @unit
  Scenario: A checkout that answers a payment page is counted as started
    When an organization starts a Growth checkout and the payment provider answers a page
    Then one started checkout is counted for that flow

  @unit
  Scenario: A refused checkout is counted with its error code
    When an organization's checkout is refused because it already has a live subscription
    Then one failed checkout is counted with the reason "subscription_already_active"
    And the refusal still reaches the caller

  @unit
  Scenario: An unexpected checkout failure is counted without its internals
    When starting a checkout fails for a reason billing did not anticipate
    Then one failed checkout is counted with the reason "unhandled"

  @unit
  Scenario: A checkout that answers no payment page is counted as failed
    When the payment provider answers no page to continue on
    Then one failed checkout is counted with the reason "no_checkout_url"

  @unit
  Scenario: A completed checkout is counted
    When the payment provider reports a checkout as completed
    Then one completed checkout is counted

  @unit
  Scenario: Both checkout doors export a started series before anyone checks out
    Given billing runs on LangWatch Cloud
    When billing starts
    Then each checkout door reports zero started checkouts
    And an alert on starts going quiet sees a series even when no one has reached checkout

  @unit
  Scenario: A self-hosted deployment exports no checkout series
    Given billing runs on a self-hosted deployment
    When billing starts
    Then no checkout series is written

  @unit
  Scenario: A license purchase or a session without a subscription is not counted as completed
    When the payment provider reports a completed license purchase, or a completed session with no subscription
    Then no completed checkout is counted

  @unit
  Scenario: Both checkout doors and the completion webhook are counted
    Given billing runs on LangWatch Cloud with a payment provider
    When a Growth seat checkout opens, a checkout for a plan with no price is refused, and a completed checkout is delivered
    Then one started, one failed and one completed checkout are counted

  @unit
  Scenario: Choosing the Free plan is not counted as a checkout
    Given billing runs on LangWatch Cloud with a payment provider
    When an organization chooses the Free plan
    Then no checkout is counted
