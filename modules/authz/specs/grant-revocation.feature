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
