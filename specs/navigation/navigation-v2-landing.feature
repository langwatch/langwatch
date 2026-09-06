Feature: Landing
  As a returning user
  I want "/" to open the product I last worked in
  So that the app starts where my work is

  The root address resolves in strict order: an explicit
  user pin wins; then the remembered product, when it is still reachable;
  then the server home resolver, which encodes the organization intent
  from ADR-038 and stays the cold-start default; then the safety nets.
  This deviates from ADR-038 deliberately: after the first product visit,
  what the user actually did outranks what the organization declared.

  Settings is never a landing destination of its own. Leaving Settings
  goes back to the product the user came from.

  @unit
  Scenario: An explicit pin outranks everything
    Given I pinned my home to "/governance"
    And the device remembers "gateway" for my organization
    When "/" resolves
    Then I land on "/governance"

  @unit
  Scenario: The remembered product outranks the organization intent
    Given the device remembers "gateway" for my organization
    And the organization intent points at a project home
    When "/" resolves
    Then I land on the Gateway home

  @unit
  Scenario: A remembered product I lost access to falls through
    Given the device remembers "governance" for my organization
    And Governance is not reachable for me anymore
    And the organization intent points at "/me"
    When "/" resolves
    Then I land on "/me"

  @unit
  Scenario: A remembered LLM Ops without any project falls through
    Given the device remembers "llm-ops" for my organization
    And no project is known on this device
    And the organization intent points at "/governance"
    When "/" resolves
    Then I land on "/governance"

  @unit
  Scenario: A first visit follows the organization intent
    Given the device remembers nothing for my organization
    And the organization intent points at "/governance"
    When "/" resolves
    Then I land on "/governance"

  @unit
  Scenario: With nothing to go on the safety nets decide
    Given the device remembers nothing for my organization
    And the server home resolver has no answer
    And a project "demo" is known on this device
    When "/" resolves
    Then I land on "/demo"

  @unit
  Scenario: Leaving Settings goes back to the product I came from
    Given I opened Settings from a Gateway page
    When I use the back entry in the Settings sidebar
    Then I return to that Gateway page

  @unit
  Scenario: The Settings back entry works even in a fresh tab
    Given a fresh tab opened Settings directly
    And the device remembers "governance" for my organization
    When I use the back entry in the Settings sidebar
    Then I land on the Governance home

  @integration
  Scenario: The root address opens the remembered product
    Given the device remembers "gateway" for my organization
    When I open "/"
    Then I am sent to the Gateway home

  @integration
  Scenario: The landing redirect navigates once per destination
    Given "/" resolved my destination
    When the landing page renders again while the navigation is in flight
    Then no second navigation starts for the same destination

  @integration
  Scenario: A member kept in an empty organization stays put
    Given my current organization has no project
    And another organization of mine has one
    When the app resolves my context
    Then I am not sent to the other organization's project

  @unit
  Scenario: Switching organization stays in the same product when possible
    Given I am in the Gateway product
    When I switch to an organization where the Gateway is reachable
    Then I land on the Gateway home of that organization

  @unit
  Scenario: Switching organization falls back when the product is not reachable
    Given I am in the Governance product
    When I switch to an organization where Governance is not reachable
    And that organization has a project "beta"
    Then I land on "/beta"
