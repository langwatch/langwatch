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

  @unit
  Scenario: A link with brackets or parentheses keeps only its text
    Given a link whose label holds brackets or whose URL holds parentheses
    When the linter strips markup
    Then only the link text stays

  @unit
  Scenario: Pathological markup strips in linear time
    Given tens of thousands of unclosed brackets, repeated half links or deeply nested links
    When the linter strips markup
    Then it finishes in well under a second without a stack overflow
