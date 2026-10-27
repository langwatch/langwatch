Feature: One Stripe customer per organization

  An organization is billed through one Stripe customer, created the first
  time anyone in it starts a checkout. Two people starting a checkout at the
  same moment must not leave the organization with two customers, because the
  one the organization does not point at is never cleaned up and can have a
  subscription attached to it by the time anyone looks.

  @integration
  Scenario: Two checkouts started together share one Stripe customer
    Given an organization with no Stripe customer
    When two people start a checkout at the same moment
    Then exactly one Stripe customer is kept on the organization
    And the other is deleted from Stripe
    And both checkouts continue with the kept customer
