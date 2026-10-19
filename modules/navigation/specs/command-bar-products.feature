Feature: Quick Search reaches every product
  As a user of the product switcher
  I want Quick Search to open any page of any product I can reach
  So that I can type a page name or switch product without leaving the keyboard

  Quick Search lists "Switch to <product>" for each reachable product, and
  every Me, Gateway and Governance page, read from the lists the sidebars
  render. Each page carries its product's name beside it. A product the
  person cannot reach is left out, exactly as the product switcher leaves
  it out. Choosing a page navigates to it, and the product follows the address.

  @integration
  Scenario: Quick Search finds a page in another product by name
    Given I can reach Me and Governance
    When I type "sessions" in Quick Search
    Then I see "Sessions" with "Me"

  @integration
  Scenario: Quick Search finds a page in another product by keyword
    Given I can reach Me, Gateway and Governance
    When I type "pull request" in Quick Search
    Then I see "Pull Requests" with "Me"
    When I type "coding agent traces" in Quick Search
    Then I see "Traces" with "Me"
    When I type "my usage" in Quick Search
    Then I see "My Usage" with "Me"

  @integration
  Scenario: Choosing a page in another product switches product and navigates
    Given I am on an LLM Ops page
    When I choose "Virtual keys" with "Gateway" in Quick Search
    Then I am sent to the Gateway virtual keys page
    And the product I am in is Gateway

  @integration
  Scenario: Quick Search switches product
    Given I can reach Governance
    When I type "switch" in Quick Search
    Then I see "Switch to Governance"
    When I choose "Switch to Governance"
    Then I am sent to the Governance home

  @integration
  Scenario: A product I cannot reach is not offered in Quick Search
    Given Governance and Gateway are not reachable for me
    When I type "switch" in Quick Search
    Then I do not see "Switch to Governance"
    And I do not see "Switch to Gateway"
    And I see no Governance or Gateway page in Quick Search

  @integration
  Scenario: Quick Search offers the Me library pages that are turned on
    Given I turned on Datasets in my personal workspace
    When I type "datasets" in Quick Search
    Then I see "Datasets" with "Me"
    And a library page I have not turned on is not offered

  @integration
  Scenario: Quick Search names LLM Ops beside its pages
    Given my project has recent coding agent sessions
    When I type "sessions" in Quick Search
    Then I see "Sessions" with "LLM Ops"
    And project pages such as "Analytics" carry "LLM Ops"
