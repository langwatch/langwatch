Feature: The device remembers the last product per organization
  As someone who works in one product most of the time
  I want the app to reopen where I actually work
  So that I never re-navigate from a home that is not mine

  In the new navigation modes the device keeps one value per organization:
  the last product visited (Me, LLM Ops, Gateway or Governance). It lives
  in localStorage, written only when the product actually changes, and is
  never synced to the account. Settings and app plumbing pages are not
  products, so visiting them never changes what is remembered.

  @unit
  Scenario: Visiting a product page remembers that product for the organization
    Given I am in organization "org_1"
    When I visit a Gateway page
    Then the device remembers "gateway" for "org_1"

  @unit
  Scenario: Two organizations keep separate memories
    Given the device remembers "gateway" for "org_1"
    When I visit a Governance page in organization "org_2"
    Then the device remembers "governance" for "org_2"
    And the device still remembers "gateway" for "org_1"

  @unit
  Scenario: Settings is never the remembered product
    Given the device remembers "gateway" for "org_1"
    When I visit "/settings/members" in organization "org_1"
    Then the device still remembers "gateway" for "org_1"

  @unit
  Scenario: Garbage in the memory reads as nothing
    Given the memory for "org_1" holds "banana"
    When the app reads the remembered product for "org_1"
    Then it reads nothing

  @unit
  Scenario: Repeating the same product does not rewrite storage
    Given the device remembers "gateway" for "org_1"
    When I visit another Gateway page in "org_1"
    Then no storage write happens

  @integration
  Scenario: Navigating the app keeps the memory current
    Given I am in a new navigation mode
    When I go from a Gateway page to a Governance page
    Then the device remembers "governance" for my organization

  @integration
  Scenario: Legacy mode writes no product memory
    Given I am in legacy mode
    When I visit a Gateway page
    Then the device remembers nothing

  @integration
  Scenario: Entering Settings captures where I came from
    Given I am in a new navigation mode
    When I go from a Gateway page to a Settings page
    Then the Settings back entry points at that Gateway page
