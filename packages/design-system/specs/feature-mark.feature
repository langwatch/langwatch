Feature: A branded feature's mark is drawn from tokens and stays crisp at every size
  As a reader meeting a branded feature such as Braids
  I want its mark to look the same wherever it appears, in light and dark
  So that I recognise the feature without the art clashing with the product

  See packages/design-system/docs/feature-branding.md.

  @integration
  Scenario: The colour mark paints its strands from the feature's colour tokens
    Given the Braids mark in colour
    When it renders
    Then the lead strand is painted from the feature's lead token
    And the other strands are painted from the feature's weave token
    And no strand carries a literal colour

  @integration
  Scenario: The mono mark takes the colour of the text around it
    Given the Braids mark in one colour
    When it renders inside text of any colour
    Then every strand is painted in the current text colour

  @integration
  Scenario: The mark draws its small master at 24 pixels and below
    Given the Braids mark at 20 pixels and at 40 pixels
    When both render
    Then the 20 pixel mark draws the small master with heavier strokes
    And the 40 pixel mark draws the standard master

  @integration
  Scenario: Two marks on one page never share a mask
    Given two Braids marks on the same page
    When both render
    Then every mask id on the page is unique
    And each strand's cut points at a mask inside its own mark

  @integration
  Scenario: The mark follows a forced colour mode
    Given the Braids mark forced to dark mode on a light page
    When it renders
    Then it carries the dark colour-mode class so its tokens take their dark values

  @integration
  Scenario: The mark is decorative unless it is given a name
    Given the Braids mark without a label, and one labelled "Braids"
    When both render
    Then the unlabelled mark is hidden from assistive technology
    And the labelled mark is an image named "Braids"
