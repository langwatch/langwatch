Feature: Every settings page keeps the settings chrome
  As someone who opens a page under Settings
  I want the same header, navigation and page frame on all of them
  So that I know where I am and can reach the other settings pages

  The chrome comes from `SettingsLayout`, which each page renders around its
  own content. `withPermissionGuard` takes a `layoutComponent` too, but that
  one frames only the refusal that a reader without the permission sees. A
  page that names the layout there and nowhere else is framed when it refuses
  the reader and bare when it serves them: no top bar, no menu, no way back
  out except the browser.

  Rule: a settings page puts its content inside the settings layout

    @integration
    Scenario: The email suppressions page carries the settings chrome
      Given I can view the triggers of this project
      When I open the email suppressions page
      Then the page content is inside the settings layout

    @unit
    Scenario: Every settings page in the routes table renders the layout
      Given the routes table registers pages under "/settings"
      When each of those pages is read
      Then every one of them renders the settings layout
