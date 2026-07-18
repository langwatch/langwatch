Feature: MainMenu compact mode avoids hydration warnings
  As a developer
  I need MainMenu's collapsed-sidebar section labels to be valid HTML
  So the React hydration warning "<div> cannot be a descendant of <p>" stays out of the console.

  Background: Chakra `<Text>` renders a `<p>`. Block elements and placeholder
  content inside that element can produce invalid nesting during hydration.
  Compact navigation omits section labels instead of rendering placeholders.

  @unit
  Scenario: MainMenu compact mode omits placeholder content
    Given the MainMenu source file
    When compact navigation section labels are hidden
    Then non-breaking placeholder content is not rendered
