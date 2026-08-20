Feature: Every settings page keeps the settings chrome
  As someone who opens a page under Settings
  I want the same header, menu and page frame on all of them
  So that I know where I am and can reach the other settings pages

  The settings chrome is the top bar, the settings menu beside the page, and
  the frame the page sits in. A page that opens without it stands alone on
  an empty background, with no menu and no way back except the browser.

  What the reader is allowed to see does not change this. The frame around a
  "you do not have permission" message and the frame around the page itself
  are two different things, so a page can be framed when it refuses the
  reader and bare when it serves them.

  Rule: a settings page opens inside the settings chrome

    @integration
    Scenario: The email suppressions page keeps it
      Given I can view the triggers of this project
      When I open the email suppressions page
      Then the page opens inside the settings chrome

    @unit
    Scenario: No page the Settings menu opens is left without it
      Given every page that Settings can open
      Then each of them keeps the settings chrome
