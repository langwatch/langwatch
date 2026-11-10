Feature: Search metadata matches the published documentation
  Page titles keep the format readers and search engines already know, and descriptions fit a search result.

  @unit
  Scenario: Page titles keep the published format
    Given a guide called "Quick Start"
    When its head is generated
    Then the title, social title and structured name follow the published format
    And the structured name has no site suffix

  @unit
  Scenario: Long descriptions are cut at a boundary
    Given a page whose description is longer than 160 characters
    When its head is generated
    Then the description ends at a full sentence or a whole word within 160 characters
    And it has no ellipsis and is the same in every place the head repeats it

  @unit
  Scenario: Short descriptions stay as authored
    Given a page whose description is shorter than 50 characters
    When its head is generated
    Then the description is unchanged

  @unit
  Scenario: Describe a guide to search engines as a technical article
    Given a guide with known first and last commit dates, and an organization that lists its X profile
    When its head is generated
    Then its structured data is a TechArticle with a headline, language, image, author and publisher
    And it is dated published at its first commit and modified at its last
    And its social type is article, with the same published and modified times
    And the social card names the organization's X account
    But the docs home stays a web page that is part of the documentation website

  @unit
  Scenario: A shared link shows the card of the section it points into
    Given a card listed for a popular section, and a default card
    When a page in that section, a page in an unlisted section and the docs home are shared
    Then the page in the section shows that section's card, sized and described for screen readers
    And the other two show the default card
    And each card is published under a name that changes whenever its text or template changes
    And adding a card is one entry in the card list

  @integration
  Scenario: Every published page carries complete search and social metadata
    Given a build whose sitemap lists its navigable pages
    When the static audit reads every listed page
    Then a page without its language, viewport, social card, social title, social description or absolute social image is reported
