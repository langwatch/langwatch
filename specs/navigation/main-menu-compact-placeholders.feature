Feature: MainMenu compact-mode placeholders avoid hydration warnings
  As a developer
  I need MainMenu's collapsed-sidebar section labels to be valid HTML
  So the React hydration warning "<div> cannot be a descendant of <p>" stays out of the console.

  Background: tracking lw#3586 F12. Chakra `<Text>` renders a `<p>`, and
  four section-label placeholders (`Evaluate`, `Library`, `Gateway`, `Ops`)
  rendered `<div>&nbsp;</div>` inside that `<Text>` for the compact state.
  React flagged this as invalid nesting. The fix replaces them with
  Fragments matching the existing `Observe` placeholder pattern.

  @unit
  Scenario: MainMenu compact-mode placeholders use Fragments not divs to avoid hydration warnings
    Given the MainMenu source file
    When scanned for the `<div>&nbsp;</div>` pattern
    Then the pattern is not present
    And Fragment-based `<>&nbsp;</>` placeholders are present
