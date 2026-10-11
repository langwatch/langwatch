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

  @integration
  Scenario: A busy overlay runs no action
    Given an overlay with a save in flight
    Then Enter in its form does not submit it
    And a menu item chosen from a menu that was already open does not run
    And Escape and an outside click do not request a close

  @integration
  Scenario: A drawer footer draws Cancel only when it is given one
    Given a drawer whose footer descriptor has no cancel
    Then the footer draws its actions and no Cancel button
    When the descriptor carries a cancel with its own label and handler
    Then Cancel is drawn once before the primary action and runs its own handler
    And while a save is in flight Cancel waits

  @integration
  Scenario: A drawer header and footer give way on a narrow screen
    Given a drawer with header tools and a footer with three actions
    Then the header row and the footer actions wrap instead of overflowing

  @integration
  Scenario: A drawer yields a docked panel's room and clears the home indicator
    Given a docked side panel and a drawer opened beside it
    Then the drawer's maximum width leaves the panel's room
    And the footer keeps its padding above the device's safe area

  @integration
  Scenario: A dialog can stand centred and keeps its size
    Given a dialog asking for a centred placement and a named size
    Then the frame is centred and carries that size
    And a dialog given no placement keeps the recipe's own place

  @integration
  Scenario: A crashed overlay keeps a named shell and a working close control
    Given a drawer built from parts, or a dialog, whose body throws while rendering
    Then the overlay keeps its accessible name and an inline error
    And its close control requests a close
    And a dialog that cannot be dismissed keeps its own footer action

  @integration
  Scenario: A crashed overlay recovers when the entity it shows changes
    Given a drawer whose content crashed for one entity
    When another entity with the same title replaces it
    Then the content renders again

  @integration
  Scenario: A dialog's initial focus skips what cannot take it
    Given a dialog whose first fields are disabled or hidden
    Then the first usable field has focus
    And a disabled requested action falls back to Cancel
    And closing the dialog returns focus to the control that opened it

  @integration
  Scenario: The retained Content parts still accept asChild
    Given a drawer or dialog content part given asChild and its own element
    Then the caller's element is the dialog and keeps its content

  @integration
  Scenario: A routed drawer opened from a modal dialog takes focus and gives it back
    Given an open modal dialog and a drawer opened from inside it
    Then the reader can type and tab inside the drawer
    And closing the drawer returns focus to the dialog's opener control and the dialog's trap holds again
