Feature: Color props come from semantic tokens
  The app's palette is defined once, as semantic tokens, so every surface
  follows the color mode. A raw palette shade written straight into a color
  prop is fixed in both modes, so it reads correctly in whichever mode the
  author had open and then goes dark-on-dark in the other — the failure the
  tokens exist to prevent.

  The check is a Biome analyzer plugin
  (platform/app/biome-plugins/semantic-color-tokens.grit), so it runs in the
  editor, in `pnpm lint`, and in CI from one rule rather than a bespoke
  checker. It names the token whose LIGHT value is the shade it replaces, so a
  fix is a swap and not a redesign.

  Background:
    Given the app defines semantic tokens for foreground, background and border
    And each palette also carries solid, solidMuted, subtle, muted, emphasized,
      fg and fgMuted

  Scenario: A raw shade in a color prop is reported
    Given a component sets a color prop to "gray.500"
    When the linter runs
    Then it reports an error
    And it names "fg.subtle" as the token to use

  Scenario: A raw shade inside an expression is reported
    Given a component sets a color prop to a ternary choosing "blue.500"
    When the linter runs
    Then it reports an error

  Scenario: A raw shade in a pseudo-state object is reported
    Given a component sets a hover style with a background of "gray.50"
    When the linter runs
    Then it reports an error

  Scenario: A raw shade in a per-mode object is reported
    Given a component sets a border to base "gray.200" and dark "border"
    When the linter runs
    Then it reports an error
    Because the token already carries both modes and the pair is redundant

  Scenario: A semantic token passes
    Given a component sets a color prop to "fg.muted"
    When the linter runs
    Then it reports nothing

  Scenario: A value that is not a color prop passes
    Given a constant named legacyCtaColor holds "orange.700"
    When the linter runs
    Then it reports nothing
    Because the rule anchors on the prop, not on every string in the file

  Scenario: A deliberate fixed-color surface opts out with a reason
    Given a CTA sits on a gradient that does not follow the color mode
    And the line carries a "biome-ignore lint/plugin" comment with a reason
    When the linter runs
    Then it reports nothing

  Scenario: A file that defines or owns a palette opts out wholesale
    Given the file carries a "biome-ignore-all lint/plugin" comment with a reason
    When the linter runs
    Then it reports nothing for that file
    Because a token has to resolve to a concrete shade somewhere, and a
      categorical identity color does not theme a surface

  Scenario: The rule must still match its own fixtures
    Given a fixtures file of deliberate violations
    When CI runs the plugin over it
    Then the violation count is at or above the recorded floor
    So that a pattern which silently stops matching fails the build instead of
      reporting a clean tree

  Scenario: A plugin that is not registered fails the fixtures floor
    Given an analyzer plugin file exists but is absent from biome.jsonc
    When CI runs the plugin over its fixtures
    Then the violation count is zero
    And the build fails
    So that an unregistered plugin cannot pass by checking nothing
