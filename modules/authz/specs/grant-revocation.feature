Feature: A revoke ends a grant only inside its own organization

  The grant projection folds a revoke by the grant's id. Every caller resolves that id inside
  its own organization today; the fold checks the organization as well, so a caller that ever
  names a foreign id cannot end another organization's grant, or a platform grant past the
  last-holder rule.

  @unit
  Scenario: A revoke ends a grant only inside its own organization
    Given a grant held in one organization
    When a revoke for that grant's id is folded under another organization
    Then the grant stays live
    And its legacy compatibility binding is left in place

  @unit
  Scenario: Changing a binding above the caller's own standing is refused
    Given a binding whose current role confers a permission the caller does not hold
    When the caller changes that binding to a lesser role
    Then the change is refused as beyond the caller's permissions
    And the binding keeps its role

  @unit
  Scenario: Demoting a binding within the caller's own standing is allowed
    Given a binding whose current role confers nothing beyond the caller's standing
    When the caller changes that binding to a lesser role
    Then the binding takes the new role
