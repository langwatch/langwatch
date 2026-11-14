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
