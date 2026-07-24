Feature: Gateway budget targeting
  As a platform engineer
  I want a gateway budget to apply to exactly one place with an unambiguous owner
  So that a budget's target and its tenancy can never become inconsistent

  # Background
  #
  # A gateway budget applies at one scope: an organization, a team, a
  # project, a virtual key, or a principal. Historically the target was
  # recorded in two places that had to be kept in lock-step (a canonical
  # scope plus a parallel set of typed columns guarded by a database CHECK
  # constraint), which created room for the two to disagree.
  #
  # ADR-021 makes the target a single inline scope on the budget, owned by
  # one organization. The duplicate typed columns, their cascade foreign
  # keys, and the CHECK constraint are removed; cleanup when a scoping
  # entity is deleted moves to the service layer. Budgets keep their own
  # five-tier set (organization, team, project, virtual key, principal);
  # those extra tiers are budget-only and are not part of the shared
  # three-tier scope contract. Budgets have no real production usage yet,
  # so the change can be aggressive.

  Background:
    Given an organization "acme" with a team "platform" and a project "web-app"

  # ────────────────────────────────────────────────────────────────────────────
  # One target, one owner
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: A budget applies to exactly one place
    When an admin creates a budget for team "platform"
    Then the budget applies to team "platform"
    And it does not apply to any other team, project, or key
    # Stored as a single inline scope; there is no second representation of
    # the target that could drift out of sync.

  @integration @unimplemented
  Scenario: A budget can target a single virtual key
    When an admin creates a budget for one virtual key
    Then the budget applies to that virtual key only
    But choosing a target in a model provider or default-model rule still cannot offer a virtual key
    # Budgets keep the budget-only virtual-key tier; the shared three-tier
    # contract used by other resources does not expose it.

  @unit @unimplemented
  Scenario: A request and its precomputed gateway config agree on which budgets apply
    Given budgets exist for the organization, the team, and the project a request runs under
    When the budgets that apply to that request are determined at request time
    And the budgets that apply are precomputed into the gateway config for the same request
    Then both agree on exactly the same set of budgets
    # One shared selection helper backs both paths so they cannot diverge.

  # ────────────────────────────────────────────────────────────────────────────
  # Tenancy
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: An organization only ever sees its own budgets
    Given another organization "globex" also has budgets
    When a member of "acme" views the gateway budgets
    Then only "acme" budgets are shown
    And no "globex" budget is ever returned
    # Every budget read is constrained to the caller's organization at the
    # data layer; an unconstrained read is rejected.

  @integration @unimplemented
  Scenario: A budget from another organization never limits this organization's traffic
    Given organization "globex" has a project-level budget
    When a request runs under project "web-app" in "acme"
    Then the "globex" budget is not applied to it

  # ────────────────────────────────────────────────────────────────────────────
  # Cleanup when a scoping entity goes away
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Deleting a team retires its budget
    Given team "platform" has a budget
    When team "platform" is deleted
    Then its budget no longer applies to anything
    And no leftover budget keeps charging against the removed team
    # Cleanup runs in the service layer rather than via a database cascade.
