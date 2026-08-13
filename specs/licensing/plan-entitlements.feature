Feature: A plan carries its entitlements however it was resolved

  As a customer on an enterprise plan
  I want the features my plan includes to work
  So that how my plan happens to be resolved is not my problem

  A plan reaches the product down one of two legs: a signed license, or a
  subscription row. Both legs answer through one resolution point, and an
  entitlement that belongs to a tier is decided there, from the tier. A flag
  added after a contract was signed therefore reaches that contract, because
  nothing about the tier changed when the flag was written.

  An entitlement the payload states explicitly is never overruled. Stating
  false is a decision, and a plan that says false keeps saying false.

  Rule: An enterprise plan is entitled on both legs

    @unit
    Scenario: An enterprise license signed before the flag existed is entitled
      Given an enterprise license whose payload never mentions webhook endpoints
      When the active plan is resolved
      Then the plan carries the webhook endpoints entitlement

    @unit
    Scenario: An enterprise subscription with no license is entitled
      Given an enterprise plan resolved from a subscription
      When the active plan is resolved
      Then the plan carries the webhook endpoints entitlement

    @unit
    Scenario: A plan below enterprise is not entitled
      Given a plan resolved on a tier that does not include webhook endpoints
      When the active plan is resolved
      Then the plan does not carry the webhook endpoints entitlement

  Rule: What a plan states explicitly wins

    @unit
    Scenario: An entitlement switched off in the payload stays off
      Given an enterprise plan whose payload switches webhook endpoints off
      When the active plan is resolved
      Then the plan does not carry the webhook endpoints entitlement

    @unit
    Scenario: A plan that needs nothing filled in is handed back untouched
      Given a plan that already answers every entitlement its tier decides
      When the active plan is resolved
      Then the plan is the same object it was, with nothing rewritten

  Rule: Authorization is never derived from a tier

    @unit
    Scenario: Impersonation powers are not an entitlement of the enterprise tier
      Given an enterprise plan resolved for a reader who is not impersonating
      When the active plan is resolved
      Then the plan does not gain the power to add limitations

    @unit
    Scenario: The unlicensed open-source baseline gains nothing from the tier map
      Given a deployment running with no license at all
      When the active plan is resolved
      Then the plan is unchanged by the tier map
