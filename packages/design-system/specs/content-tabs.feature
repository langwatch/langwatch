Feature: Content tabs
  As someone switching between views of one subject on a page
  I want tabs that behave the same everywhere
  So that the keyboard, the screen reader and the panels work without each screen reinventing them
  Rulings: .claude/tmp/ds-sweep/shapes-spec-2.md sections 2 and 8 (Alex, 2026-10-11)

  @integration
  Scenario: Tabs expose the tablist, tab and tabpanel relationships
    Given content tabs under each mount policy
    Then the tablist is named, every tab has a valid aria-controls and each panel is labelled by its tab
    And closed panels stay in the document as hidden shells

  @integration
  Scenario: Arrow keys, Home and End move between tabs
    Given content tabs with automatic activation
    When the reader presses the arrow keys, Home and End
    Then focus wraps through the tabs and selects as it goes
    And the selected tab is the one tab stop before the panel

  @integration
  Scenario: Manual activation selects only on Enter or Space
    Given content tabs with manual activation
    When the reader arrows to another tab
    Then focus moves but nothing is selected until Enter or Space

  @integration
  Scenario: A tab can be disabled with a reason and stays reachable
    Given a disabled tab with a reason
    Then arrow keys reach it and the reason is described to assistive technology
    And it is never selected

  @integration
  Scenario: The selected tab stays selected when it becomes disabled
    Given the current tab becomes disabled
    Then it stays selected and its panel stays open

  @integration
  Scenario: A value no tab has selects nothing and says so in development
    Given a value that matches no tab
    Then no tab is selected and no panel shows
    And the first tab stays reachable by keyboard
    And a development build reports the value

  @integration
  Scenario: A duplicate value renders the first and reports it in development
    Given two items sharing a value
    Then only the first renders
    And a development build reports it

  @integration
  Scenario: With no enabled item every tab is disabled and no panel shows
    Given only disabled items and no matching value
    Then every tab is aria-disabled and no panel shows

  @integration
  Scenario: A value changed from outside never steals focus
    Given a button outside the tabs that changes the value
    When the reader presses it
    Then the tab changes and focus stays on the button

  @integration
  Scenario: A removed focused tab moves focus to the selected tab
    Given the focused tab leaves the items
    Then focus moves to the selected tab, never to the body

  @integration
  Scenario: Panels mount lazily, only while open, or always
    Given tabs whose first panel holds state
    Then lazy keeps the state after leaving, active drops it and all mounts every panel at once

  @integration
  Scenario: Actions and the panel header sit outside the tablist
    Given tabs with actions, a panel header and a shortcut
    Then the actions follow the tablist in tab order and sit outside it
    And the panel header persists across tabs outside every panel
    And the shortcut is set as aria-keyshortcuts

  @integration
  Scenario: CodeTabs shows one shared body and copies the open snippet
    Given code tabs with two languages
    Then only the open snippet is shown and the copy action sits outside the tablist
    And copying writes the open snippet

  @integration
  Scenario: CodeTabs highlights in the page's colour mode, forced or not
    Given code tabs under a colour mode forced to dark, and again forced to light
    Then the dark page highlights with the dark theme and the light page with the light theme

  @integration
  Scenario: MetricTabs names a tab by label and figure and waits for Enter
    Given metric tabs
    Then each tab is named by its label then its figure
    And closed panels are unmounted
    And arrowing past a tab selects nothing until Enter

  @integration
  Scenario: A counted tab has a separated accessible name
    Given tabs labelled People with a count of 5, Teams with a count of 0 and Audit with none
    Then their accessible names are People 5, Teams 0 and Audit
    And arrow keys still move between them

  @integration @browser
  Scenario: A side inset keeps the strip's rule full width
    Given content tabs with no inset, a 16px inset and a 24px inset, padded and flush
    Then the tabs and the open panel's content start 0, 16 and 24px in
    And the rule under the strip spans the whole width, in a narrow host too
