Feature: The branded card frames a standalone page
  As a reader who lands on a page from a link or a command line
  I want it to look like the LangWatch sign-in doors
  So that the page reads as the product and not as a bare box

  @integration
  Scenario: A page under the branded card shows the logo and a centred title
    Given a page rendered inside the branded card
    When the reader looks at the card
    Then the LangWatch logo sits above the title
    And the title and the intro line are centred
