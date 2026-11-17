Feature: prose-lint reads link text, not link targets
  The regex rules judge prose. A link's URL is not prose, so a lowercase org
  name in a GitHub path does not trip the product casing rule.

  @unit
  Scenario: A link keeps its text and drops its URL
    Given a sentence with a markdown link to a GitHub path
    When the linter strips markup
    Then the link text stays and the URL is gone

  @unit
  Scenario: An image goes entirely
    Given a sentence with a markdown image
    When the linter strips markup
    Then neither the alt text nor the URL stays
