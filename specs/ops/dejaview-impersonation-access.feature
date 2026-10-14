Feature: Ops access (Deja View) while impersonating a user
  As a platform admin debugging a customer account
  I want the ops tooling (Deja View) to stay available while I impersonate the customer
  So that I can inspect the customer's stored events in the context of their account

  # While impersonating, the operator's own grant carries through for reading
  # only; ops:manage waits until they sign in as themselves (Alex, 2026-10-14;
  # bound in modules/ops/specs/admin.feature).

  Scenario: Admin impersonating a customer keeps ops access
    Given an admin is impersonating a customer user
    When the ops scope is resolved for the session
    Then the session has platform ops access
    And the Deja View section is available in the UI
    But an ops write that asks ops:manage is refused
    And ending the impersonation still works

  Scenario: Customer session without impersonation has no ops access
    Given a customer user is signed in normally
    When the ops scope is resolved for the session
    Then the session has no ops access
    And the Deja View section is not shown

  Scenario: Non-admin impersonator does not gain ops access
    Given a session is impersonating with an impersonator who is not an admin
    When the ops scope is resolved for the session
    Then the session has no ops access

  Scenario: Admin session without impersonation keeps ops access
    Given an admin is signed in normally
    When the ops scope is resolved for the session
    Then the session has platform ops access
