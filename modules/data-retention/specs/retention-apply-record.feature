Feature: Each retention change and each apply to stored data is recorded

  A saved period reaches stored rows only when it is applied, so the settings
  page says, per scope, whether its last change was applied. Every save records
  a retention_policy_changed fact for its scope, and every project's rewrite
  records a retention_applied fact naming the scope that asked for it. A scope
  is applied once an exact apply at that scope, or at a scope that holds it,
  landed at or after its last change. A lengthening save only raises stamps, so
  its raise counts as applied only when no shorter save since the last exact
  apply left stamps above the period.

  Background:
    Given an organization on a paid plan with a team and two projects

  @unit
  Scenario: Saving a period records the change for its scope
    When an admin saves 56 days for traces on the organization
    Then a retention_policy_changed fact names the organization scope, traces and 56 days
    And it is recorded once however often the save is delivered

  @unit
  Scenario: A shorter save records the change but rewrites nothing
    Given the organization keeps traces for 91 days
    When an admin saves 56 days for traces on the organization
    Then a retention_policy_changed fact is recorded
    And no project's stored rows are rewritten

  @unit
  Scenario: A change that cannot be recorded still saves the rule
    Given recording the change fails
    When an admin saves 56 days for traces on the organization
    Then the rule is saved
    And the save answers with the rule

  @unit
  Scenario: Each project's rewrite records the scope that asked for it
    When an admin applies the organization's period to stored data
    Then every project's retention_applied fact names the organization scope

  @unit
  Scenario: The status keeps the latest change and the latest apply whatever their order
    Given a change at 10:00 and an apply at 11:00 for the same scope
    When the facts are folded in either order
    Then the scope's status holds the change at 10:00 and the apply at 11:00

  @unit
  Scenario: An apply at or after the last change marks the scope applied
    Given a scope changed at 10:00 and applied at 11:00
    Then the scope reads as applied at 11:00

  @unit
  Scenario: A change after the last apply marks the scope pending
    Given a scope applied at 10:00 and changed again at 11:00
    Then the scope reads as pending since 11:00

  @unit
  Scenario: The status keeps raises apart from exact applies
    Given a lengthening save at 10:00 raised at 11:00
    When the facts are folded
    Then the scope's status holds the raise at 11:00 and no exact apply

  @unit
  Scenario: Only a save that keeps fewer days blocks a later raise
    Given a save at 10:00 that kept fewer days and an unchanged save at 11:00
    When the facts are folded
    Then the scope's status holds the shorter save at 10:00
    And an unchanged or longer save is never held as shorter

  @unit
  Scenario: A first override shorter than the period it inherited blocks a later raise
    Given the organization keeps traces for 91 days
    When an admin saves the project's first override of 56 days for traces
    Then the save is recorded as keeping fewer days

  @unit
  Scenario: A raise after a lengthening save marks the scope applied
    Given a scope lengthened at 10:00 and raised at 11:00
    Then the scope reads as applied at 11:00

  @unit
  Scenario: A raise after an unapplied shorter save leaves the scope pending
    Given a scope applied at 09:00, shortened at 10:00 and lengthened at 11:00
    And the lengthening save was raised at 12:00
    Then the scope reads as pending since 11:00

  @unit
  Scenario: A save whose change was not recorded never reads as applied
    Given a scope changed at 10:00 and applied at 11:00
    And its rule was saved again at 12:00 without the change being recorded
    Then the scope reads as pending since 12:00

  @unit
  Scenario: An apply at a wider scope covers the scopes it holds
    Given a project rule changed at 10:00
    And the organization applied at 11:00
    Then the project's scope reads as applied at 11:00
    And an apply on its team covers it the same way

  @unit
  Scenario: A rule with no recorded change shows no status
    Given a rule saved before changes were recorded
    Then the snapshot names no status for its scope

  @integration
  Scenario: The settings page says when a scope was applied
    Given a team's rule was applied on 22 Nov 2026
    When the settings page lists the team's rule
    Then its row says "Applied on 22 Nov 2026"

  @integration
  Scenario: The settings page says a scope is not applied yet
    Given a team's rule changed after its last apply
    When the settings page lists the team's rule
    Then its row says "Not applied to stored data yet"
