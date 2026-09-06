Feature: Ops access (Deja View) while impersonating a user
  As a platform admin debugging a customer account
  I want the ops tooling (Deja View) to stay available while I impersonate the customer
  So that I can inspect the customer's stored events in the context of their account

  # =========================================================================
  # What this covers
  # =========================================================================
  #
  # Impersonation rewrites the session identity to the impersonated
  # (customer) user, keeping the real admin as the session's impersonator.
  # Ops access is granted per admin email, so before this feature the ops
  # UI (Deja View) disappeared exactly when an admin was impersonating a
  # customer to debug their traces. The impersonator's own grant now
  # carries through the impersonation session.

  Scenario: Admin impersonating a customer keeps ops access
    Given an admin is impersonating a customer user
    When the ops scope is resolved for the session
    Then the session has platform ops access
    And the Deja View section is available in the UI

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
