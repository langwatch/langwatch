Feature: Refusing Enterprise-only work on a lower plan

  Enterprise-only REST and setup routes refuse a lower plan with 402 and the
  stable code enterprise_plan_required, as main did. The older tRPC plan
  assertions answered FORBIDDEN on main, so they keep 403 with the same code.

  @unit @entitlements
  Scenario: A REST or setup gate refuses a non-Enterprise plan with 402
    Given an organization on a plan below Enterprise
    When a route gated to the Enterprise plan refuses it
    Then the refusal is enterprise_plan_required with status 402
    And the refusal names the feature it asked for

  @unit @entitlements
  Scenario: A tRPC plan assertion refuses a non-Enterprise plan with 403
    Given an organization on a plan below Enterprise
    When a tRPC procedure asserts the Enterprise plan
    Then the refusal is enterprise_plan_required with status 403
