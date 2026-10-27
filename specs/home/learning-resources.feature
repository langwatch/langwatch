Feature: Learning Resources
  As a user
  I want pointers to documentation and tutorials from the home page
  So that I can learn the platform when I need to — without the pointers
  competing with my own project's data

  The section is a quiet footer row of text links under a hairline rule,
  not banner cards: the home page belongs to the returning user's live
  signal, and learning material is reference, not a destination.

  Background:
    Given I am on the home page

  @integration
  Scenario: Every footer link points at its destination
    When I view the resources footer
    Then I see these links, in this order, with these addresses
      | label          | href                                                  |
      | Python SDK     | https://docs.langwatch.ai/integration/python/guide     |
      | TypeScript SDK | https://docs.langwatch.ai/integration/typescript/guide |
      | Go SDK         | https://docs.langwatch.ai/integration/go/guide         |
      | Scenario       | https://scenario.langwatch.ai                          |
      | REST API       | https://docs.langwatch.ai/integration/rest-api         |
      | GitHub         | https://github.com/langwatch/langwatch                 |
      | Status         | https://status.langwatch.ai                            |
      | Terms          | https://langwatch.ai/legal/terms-conditions            |
      | Privacy Policy | https://langwatch.ai/legal/privacy-policy              |

  @integration
  Scenario: Footer links open outside the product
    When I follow any link in the resources footer
    Then it opens in a new tab
    And the page it opens cannot reach back into the product

  @integration
  Scenario: The footer carries no development controls
    When I view the resources footer
    Then it holds only the copyright line and its links
