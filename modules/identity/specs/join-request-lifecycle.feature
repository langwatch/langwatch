@identity
Feature: Join request lifecycle

  @unit
  Scenario: An expired join request tells its requester
    Given a join request that has expired
    When its lapse is dispatched
    Then the requester is told their request lapsed
