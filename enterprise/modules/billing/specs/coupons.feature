Feature: Coupons in the Cloud admin console
  Sales hands customers Stripe promotion codes. The Growth checkout bills a prorated
  first period up to the 1st of next month, and Stripe refuses some coupons on such a
  checkout with only "This code is invalid". The Coupons page under /ops lists every
  coupon and code in the account, says per code whether the Growth checkout accepts it,
  and only creates coupons that it accepts.

  Background:
    Given LangWatch Cloud with a Stripe key
    And a platform operator signed in to the admin console

  Rule: Only platform operators see or change coupons

    @unit
    Scenario: Someone who is not a platform operator is answered not found
      Given a signed-in user without ops:view
      When they ask for the coupon list
      Then they are answered not found

    @unit
    Scenario: An operator with view access cannot create a coupon
      Given an operator holding ops:view but not ops:manage
      When they create a coupon
      Then the request is refused by name

    @unit
    Scenario: The page answers not found off LangWatch Cloud
      Given a self-hosted deployment
      When an operator opens /ops/coupons
      Then the page is not found

  Rule: The list shows every coupon with its codes, newest first

    @unit
    Scenario: Coupons and their promotion codes are listed
      Given the Stripe account holds coupon "Half off" with code "HALF50"
      When the operator opens the Coupons page
      Then "Half off" is listed with its discount, duration and product limit
      And "HALF50" is listed under it with its redemptions, expiry and restrictions

    @unit
    Scenario: The list fails clearly when Stripe is unreachable
      Given Stripe refuses the coupon listing
      When the operator opens the Coupons page
      Then the page says the coupons could not be loaded and offers a retry

  Rule: Each code says whether the Growth checkout accepts it, and why not

    @unit
    Scenario Outline: A code the Growth checkout refuses is flagged with the reason
      Given a code whose coupon or restrictions are <setup>
      When its compatibility with the Growth checkout is judged
      Then it is flagged "<reason>"

      Examples:
        | setup                                         | reason                                                       |
        | a fixed amount off                            | Fixed-amount coupons are refused on the prorated checkout    |
        | limited to products that exclude Growth Seats | Does not apply to Growth Seats                               |
        | first-time orders only                        | First-time-only codes are refused for existing customers     |
        | inactive                                      | The code is inactive                                         |
        | past their expiry date                        | The code has expired                                         |
        | at their redemption limit                     | The code has reached its redemption limit                    |

    @unit
    Scenario: A minimum order amount is a warning measured on the prorated first charge
      Given a code with a minimum order amount
      When its compatibility with the Growth checkout is judged
      Then it is accepted with a warning that the minimum is checked on the prorated first charge

    @unit
    Scenario: A code limited to one customer is a warning, not a refusal
      Given a code only one customer may redeem
      When its compatibility with the Growth checkout is judged
      Then it is accepted with a warning that only that customer can redeem it

    @unit
    Scenario: The page says no code discounts the prorated first charge
      When the operator opens the Coupons page
      Then it says the first charge up to the 1st of next month is never discounted
      And that the discount months count from the day of checkout

    @unit
    Scenario: A percentage code on Growth Seats with no restrictions is accepted
      Given a 50% coupon limited to the Growth Seats product with an unrestricted code
      When its compatibility with the Growth checkout is judged
      Then it is accepted with no warnings

  Rule: Creating a coupon only makes what the Growth checkout accepts

    @unit
    Scenario: The operator creates a percentage coupon with a code
      Given the operator fills in 50% off for 2 months, code "WELCOME50"
      When they create the coupon
      Then Stripe holds a 50% coupon repeating for 2 months
      And it applies to the Growth Seats product of the current Stripe mode only
      And it holds the promotion code "WELCOME50" with no first-time restriction
      And the new coupon appears at the top of the list

    @unit
    Scenario: The coupon may also cover event usage
      Given the operator ticks "Also discount event usage"
      When they create the coupon
      Then it applies to both the Growth Seats and the Growth Events products

    @unit
    Scenario: A code may be capped and given an expiry
      Given the operator sets a limit of 10 redemptions and an expiry date
      When they create the coupon
      Then the promotion code holds that limit and that expiry

    @unit
    Scenario Outline: An invalid coupon is refused before it reaches Stripe
      Given the operator enters <input>
      When they create the coupon
      Then it is refused with "<message>"
      And nothing is created in Stripe

      Examples:
        | input                                | message                                            |
        | 0% off                               | The discount must be between 1% and 100%           |
        | 101% off                             | The discount must be between 1% and 100%           |
        | a repeating coupon with no months    | Say how many months the discount lasts             |
        | the code "half off!"                 | Codes use letters, digits, dashes and underscores  |
        | an expiry date in the past           | The expiry date must be in the future              |

    @unit
    Scenario: A code already taken by an active promotion code is refused by name
      Given an active promotion code "WELCOME50"
      When the operator creates a coupon with code "WELCOME50"
      Then it is refused with "An active code WELCOME50 already exists"
      And no coupon is left behind without its code

  Rule: An operator can retire a code so its name can be reused

    @unit
    Scenario: The operator deactivates a promotion code
      Given an active promotion code "DISCOUNTCS"
      When the operator deactivates it
      Then Stripe marks the code inactive
      And a new coupon may take the code "DISCOUNTCS"
