Feature: Colours in the app come from semantic tokens
  The app's palette is defined once, as semantic tokens, so every surface
  follows the colour mode. A raw palette shade written straight into a colour
  prop is fixed in both modes, so it reads correctly in light and then goes
  dark-on-dark — the failure the tokens exist to prevent.

  A check runs on every pull request and fails when a raw shade reaches a
  colour prop, naming the file, the line and the token to use instead.

  Background:
    Given the app defines semantic tokens for foreground, background, border
    And each palette also carries solid, subtle, muted, emphasized and fg

  Scenario: A raw shade in a colour prop fails the check
    Given a component sets a colour prop to "gray.500"
    When the check runs
    Then it fails
    And it reports the file and line
    And it names "fg.subtle" as the token to use

  Scenario: A raw shade inside an expression fails the check
    Given a component sets a colour prop to a ternary choosing "blue.500"
    When the check runs
    Then it fails
    And it names "blue.solid" as the token to use

  Scenario: A raw shade in a pseudo-state object fails the check
    Given a component sets a hover style with a background of "gray.50"
    When the check runs
    Then it fails
    And it names "bg.subtle" as the token to use

  Scenario: A semantic token passes
    Given a component sets a colour prop to "fg.muted"
    When the check runs
    Then it passes

  Scenario: The theme definition may name raw shades
    Given the file defines the semantic tokens themselves
    When the check runs
    Then it passes
    Because a token has to resolve to a concrete shade somewhere

  Scenario: A surface that is dark in both colour modes may name raw shades
    Given the file is listed as a fixed-palette surface
    And it renders a terminal whose background does not follow the colour mode
    When the check runs
    Then it passes

  Scenario: A categorical identity palette may name raw shades
    Given the file is listed as a categorical palette
    And it assigns one fixed colour per feature or span type
    When the check runs
    Then it passes
    Because the colour identifies the thing rather than theming a surface

  Scenario: An exempt file that no longer exists fails the check
    Given a file is listed as exempt
    And that file has been deleted or renamed
    When the check runs
    Then it fails
    So that the exemption list cannot rot unnoticed
