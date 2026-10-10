Feature: What's new in the sidebar
  As a LangWatch user
  I want the latest entry of the public weekly changelog one click away in the sidebar
  So that I notice new features without leaving the product

  The source is the public changelog at https://langwatch.ai/changelog: its RSS feed names the
  latest entry, and that entry's page gives the first screenshot and the "What You Can Do Now"
  lines. The server reads both at most once a day per process and sends no identifying data.

  Background:
    Given I am signed in

  @integration
  Scenario: The latest changelog entry shows behind a sidebar button
    Given the changelog feed's latest entry is "Instant evals in the trace explorer"
    And its page has a screenshot and four "What You Can Do Now" lines
    When I open any page with the sidebar
    Then the sidebar bottom block shows a "What's new" button with the tooltip "Hot and fresh features"
    When I click it
    Then a card opens above the button with the overline "What's new"
    And the headline "Instant evals in the trace explorer"
    And the entry's first screenshot
    And the four feature lines, each linking out
    And a full-width "Read the update" button opening the entry in a new tab

  @unit
  Scenario: An unseen entry carries a dot until the card is opened
    Given the latest entry is one I have not opened
    Then the "What's new" button shows a dot
    When I open the card
    Then the entry is remembered as seen on my account
    And the dot is gone, on this and every other browser I sign in from

  @unit
  Scenario: A newer entry brings the dot back
    Given I opened the card for last week's entry
    When a newer entry is published to the changelog
    Then the "What's new" button shows a dot again

  @unit
  Scenario: The changelog is read at most once a day per process
    Given the server read the changelog less than a day ago
    When another person loads the sidebar
    Then the server answers from what it read and fetches nothing

  @unit
  Scenario: An entry page without a screenshot or feature lines still shows the card
    Given the latest entry's page has no image and no "What You Can Do Now" section
    When I open the card
    Then it shows the overline, the headline and the "Read the update" button only

  @unit
  Scenario: The changelog cannot be reached
    Given the changelog does not answer within a few seconds, or answers with an error
    When I load the sidebar
    Then no "What's new" button is shown
    And no error toast appears

  @unit
  Scenario: The feed cannot be parsed
    Given the changelog feed answers with something that is not an RSS feed
    When I load the sidebar
    Then no "What's new" button is shown

  @unit
  Scenario: Air-gapped installations turn the changelog off
    Given the deployment sets DISABLE_WHATS_NEW to "true"
    When I load the sidebar
    Then the server never calls the changelog
    And no "What's new" button is shown

  Scenario: Marking an entry seen needs a signed-in person
    Given I am not signed in
    When something calls "user.markWhatsNewSeen"
    Then it is refused as unauthenticated
