Feature: Drawer and dialog shapes
  As someone building a LangWatch screen
  I want one prop-driven drawer and one prop-driven dialog
  So that every overlay has the same header, body and footer without restyling
  Rulings: packages/design-system/adrs/002-overlay-and-card-shapes.md

  @integration
  Scenario: A drawer draws its slots and a footer without Cancel
    Given a drawer with a title, an eyebrow, a subtitle, badges and a footer primary action
    Then the drawer is named by its title and described by its subtitle
    And the footer shows the primary action and no Cancel button

  @integration
  Scenario: Closing an overlay is a request the caller answers
    Given an open drawer
    When the reader presses the close button or Escape
    Then the caller's onClose runs and the drawer stays until the caller closes it
    And while a save is in flight the close button and Escape wait

  @integration
  Scenario: A footer submit action submits the right form once
    Given an overlay that owns its form
    When the reader presses the submit action or Enter in a field
    Then the overlay's onSubmit runs exactly once
    And a submit action naming a child form's id submits that form instead

  @integration
  Scenario: An overlay body shows loading and failure in place of its content
    Given a drawer whose read is loading or has failed
    Then skeleton rows or an error banner with a retry replace the body

  @integration
  Scenario: A render crash keeps the overlay open and named
    Given a drawer whose content throws while rendering
    Then the drawer stays open with an inline error and its close button
    And the drawer keeps its accessible name

  @integration
  Scenario: A dialog keeps Cancel unless a second choice takes its place
    Given a dialog with a primary action
    Then the footer shows Cancel beside the primary action
    When the dialog has a secondary action
    Then the secondary action takes Cancel's place

  @integration
  Scenario: A dialog that must be acknowledged cannot be dismissed
    Given a dialog that is not dismissible
    Then it has no close button and no Cancel
    And Escape does not request a close

  @integration
  Scenario: Popups opened inside an overlay portal into it
    Given a select and a menu with a submenu inside an open dialog
    When the reader opens them
    Then their options render inside the dialog, so its focus trap still holds them

  @integration
  Scenario: A dialog focuses the requested action first
    Given a dialog asking to focus its primary action
    Then the primary action has focus when it opens
    And without a request the first field has focus

  @integration
  Scenario: The shell tells overlay error fallbacks it is a development build
    Given the design system provider says the build is a development build
    When an overlay's content crashes
    Then the inline error shows the raw crash text, which production never shows

  @integration
  Scenario: The confirmation dialog keeps its old props while callers move
    Given a confirmation dialog given the deprecated onOpenChange and message
    Then it shows the message and Cancel requests onOpenChange(false)
