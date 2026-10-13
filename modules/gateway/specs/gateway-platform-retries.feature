@gateway
Feature: Retried gateway platform creates
  A replayed request with the same key does not create a second resource.

  @integration
  Scenario: A retried virtual-key create does not mint a second key
    Given a virtual-key create request that already succeeded
    When the same request is replayed
    Then the key is created happens once

  @integration
  Scenario: A retried virtual-key rotate does not mint a second secret
    Given a virtual-key rotate request that already succeeded
    When the same request is replayed
    Then the rotation happens once

  @integration
  Scenario: A retried budget create does not mint a second budget
    Given a budget create request that already succeeded
    When the same request is replayed
    Then the budget is created happens once

  @integration
  Scenario: A retried cache-rule create does not mint a second rule
    Given a cache-rule create request that already succeeded
    When the same request is replayed
    Then the cache rule is created happens once
