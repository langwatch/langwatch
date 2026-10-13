Feature: The /me budget banner, served by the gateway

  # main served this as user.personalBudget, reading the caller's personal key
  # and the gateway's budget check. The gateway owns both, so it serves the
  # banner itself as gatewayBudgets.personalBudget.

  @unit
  Scenario: The /me budget banner is served by the gateway on the same terms
    Given the browser's budget banner
    When it asks the gateway for the caller's personal budget in an organization
    Then the query asks organization:view before the application is reached
    And it answers the caller's own banner state

  @unit
  Scenario: The personal budget warns at the gateway's soft warning on the caller's own key
    Given a member holding a personal gateway key whose budget is at a soft warning
    When they read their personal budget in that organization
    Then the gateway checks the budget against that key at no projected cost
    And the personal budget answers a warning with the spend and the limit

  @unit
  Scenario: A member without a personal key is checked on the principal scope
    Given a member who holds no personal gateway key
    When they read their personal budget in that organization
    Then the gateway checks a key id that matches no key-scoped budget

  @unit
  Scenario: A member without a personal workspace has no budget to describe
    Given a member with no personal workspace in the organization
    When they read their personal budget in that organization
    Then the answer is a bare ok and the gateway is not asked
