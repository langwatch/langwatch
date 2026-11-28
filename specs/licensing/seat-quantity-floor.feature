Feature: Seat count never goes below the seats in use

  As LangWatch
  I want a seat change to be refused when it asks for fewer seats than are in use
  So that an organization cannot pay for fewer seats than it uses, or for none

  Rule: the minimum is the full member seats in use, and never below one
  The count is the one the seat limit is enforced on: active full members and
  live invitations. The check runs on the server before any call to the
  payment provider, for the Growth seat model and the legacy tiered model alike.

  Background:
    Given an organization on a paid Stripe plan
    And 5 full member seats are in use

  @unit
  Scenario: A seat change at or above the seats in use goes through
    When an administrator sets the seat count to 5
    Then the payment provider receives the new seat count

  @unit
  Scenario: A seat change below the seats in use is refused
    When an administrator sets the seat count to 3
    Then the change is refused with "seat_quantity_below_in_use" and a minimum of 5
    And the payment provider is not called

  @unit
  Scenario: A seat change that leaves members out is refused, not sent as zero seats
    When a seat change is sent with members left out of the upgrade
    Then the change is refused with "seat_quantity_below_in_use"
    And the payment provider is not called

  @unit
  Scenario: An organization with no seats in use still keeps one seat
    Given no full member seats are in use
    When an administrator sets the seat count to 0
    Then the change is refused with "seat_quantity_below_in_use" and a minimum of 1

  Rule: Developer seats never go below the Developers in use
  A Developer seat line is billed apart from the full seats (ADR-171). The
  count is the one the organization classifies: members whose seat is
  Developer and live Developer invitations. Unlike full seats the line may go
  to zero, but only when no Developer is in use. The check runs on the server
  before any call to the payment provider, and nobody is removed to fit.

  Background:
    Given an organization on Growth with a Developer seat price configured
    And the subscription bills 3 Developer seats
    And 2 Developers are in use

  @unit
  Scenario: Lowering Developer seats to the Developers in use goes through
    When an administrator sets 2 Developer seats
    Then the payment provider receives a Developer seat line of 2

  @unit
  Scenario: Lowering Developer seats below the Developers in use is refused
    When an administrator sets 1 Developer seat
    Then the change is refused with "seat_quantity_below_in_use" and a minimum of 2 Developer seats
    And the payment provider is not called

  @unit
  Scenario: Removing every Developer seat is refused while Developers are in use
    When an administrator sets 0 Developer seats
    Then the change is refused with "seat_quantity_below_in_use" and a minimum of 2 Developer seats
    And the Developer seat line is kept

  @unit
  Scenario: Removing every Developer seat goes through when no Developer is in use
    Given no Developers are in use
    When an administrator sets 0 Developer seats
    Then the Developer seat line is removed

  @unit
  Scenario: The refusal names the Developer seats and the minimum
    When a Developer seat change is refused with a minimum of 2
    Then I am told "That's too few seats" and "Nothing changed. Choose at least 2 developer seats."

  Rule: every seat kind sold on a subscription has a floor
  A new seat price family in the catalogue fails the build until its seat kind
  declares the minimum it may be lowered to. Seat prices are the *_SEAT_* families
  and the legacy *_USERS full-seat prices.

  @unit
  Scenario: Every seat price in the catalogue belongs to a seat kind with a floor
    Given the seat price names in the Stripe price catalogue
    Then each one belongs to a seat kind that declares its floor
