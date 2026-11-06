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
    Then one failed checkout is counted with the code "subscription_already_active"
    And the refusal still reaches the caller

  @unit
  Scenario: An unexpected checkout failure is counted without its internals
    When starting a checkout fails for a reason billing did not anticipate
    Then one failed checkout is counted with the code "unhandled"

  @unit
  Scenario: A checkout that answers no payment page is counted as failed
    When the payment provider answers no page to continue on
    Then one failed checkout is counted with the code "no_checkout_url"

  @unit
  Scenario: A completed checkout is counted
    When the payment provider reports a checkout as completed
    Then one completed checkout is counted
