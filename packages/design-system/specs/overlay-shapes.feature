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
  Scenario: A dialog finished by one action can drop Cancel and stay dismissible
    Given a dialog with a primary action and no Cancel
    Then the footer shows only the primary action
    And the X requests one close and Escape requests one close
    And a dialog with no primary action and no Cancel still has the X

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
  Scenario: A drawer footer holds several outline actions without a primary
    Given a drawer whose footer carries only secondary actions
    Then every action is drawn in the order given, with no Cancel and no solid primary
    And a singular secondary action is drawn before the array
    And a loading, disabled or busy action runs nothing and keeps its name or reason

  @integration @browser
  Scenario: A secondary action's tone colours its outline
    Given secondary actions that are neutral, danger, success and info
    Then each coloured one keeps an outline in its palette's text, border and hover colours
    And the neutral one keeps today's look in light and dark
    And at 320px every label stays reachable without horizontal overflow

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

  @integration @browser
  Scenario: A non-modal drawer returns focus to the control that opened it
    Given a drawer opened from a button on the page
    When it closes by its X, Escape, its Cancel, a footer action or its owner unmounting it
    Then focus is on the opener once the drawer has gone
    And the page has not scrolled

  @integration @browser
  Scenario: A drawer returns focus to an explicit target and skips one that cannot take it
    Given a drawer given a live final focus resolver
    Then focus goes to what the resolver answers when it closes, not to the opener
    And a resolver that answers nothing falls back to the opener
    And a removed, disabled or hidden target takes no focus and nothing throws

  @integration @browser
  Scenario: A drawer does not take back focus that moved on by choice
    Given a drawer whose reader moves focus to the page or a dialog opens as it closes
    Then focus stays where the reader or the dialog put it
    And closing then reopening quickly leaves focus in the drawer

  @integration @browser
  Scenario: A drawer mounted open, or rendered twice by StrictMode, restores only after a real close
    Given a drawer that mounts open, or never opens, under StrictMode
    Then nothing is focused or restored while it is open or closed
    And one real close restores focus exactly once

  @integration @browser
  Scenario: A drawer that exits under reduced motion still returns focus
    Given a reader who has asked for reduced motion
    Then closing the drawer returns focus to its opener

  @integration @browser
  Scenario: A drawer opened over a dialog leaves restoration to the dialog's trap
    Given an open modal dialog and a drawer opened from inside it
    Then the drawer is modal and closing it returns focus to the dialog's control once
    And a part-built drawer returns focus to its trigger as well

  @integration @browser
  Scenario: A routed drawer closing over a dialog that re-renders hands focus back without an error
    Given an open modal dialog and a routed drawer opened from inside it
    When a pick in the drawer updates the dialog and unmounts the drawer in one render
    Then no focus trap error is raised
    And focus is back inside the dialog

  @integration
  Scenario: A routed drawer stack hands the page opener to its last drawer
    Given a page button that opens a routed drawer which opens another
    When the reader pushes, goes back and closes the whole stack
    Then pushing restores nothing and going back focuses the returned drawer
    And closing the stack returns focus to the page button, even when the drawer loads lazily
    And a deep link has no opener to restore

  @unit
  Scenario: The translucent header and footer are on by default, approved after the screenshots
    Given a drawer rendered with no glass switch
    Then it gets the translucent bands
    And the same drawer with the glass switch turned off keeps the solid look

  @integration @browser
  Scenario: A drawer opened by a click shows no focus ring on its close button
    Given a drawer opened with the pointer, whose close button takes focus
    Then the close button draws no focus ring
    And a close button reached with the keyboard keeps its ring

  @integration @browser
  Scenario: A drawer title is medium weight with no rule under the header
    Given a drawer with a title, glass on or off
    Then the title renders at medium weight
    And no border is drawn under the header while nothing scrolls beneath it

  @integration
  Scenario: A glass drawer overlays its header band and footer on the one scrolling body
    Given a drawer under the glass switch with a toolbar, a footer and a long body
    Then the header band, body and footer keep that order and the body is the scrollport
    And the body's padding follows the measured band heights
    And a drawer whose body owns its scrolling keeps its bands as flex siblings
    And the close control stays above the header band

  @integration
  Scenario: A glass drawer's header and footer edges follow what scrolls beneath them
    Given a glass drawer whose body overflows
    Then the header edge is off at the top and on once the body scrolls
    And the footer edge is on until the body reaches its end
    And nothing is on when the content fits
    And the drawer's observers and listeners are released when it closes

  @integration @browser
  Scenario: A drawer title keeps its 24px source icon visible
    Given a drawer with a 24px icon and a long title
    Then the icon stays 24px, unclipped, beside a title that wraps
    And the drawer is still named by its title alone
    And a drawer without an icon keeps the header it had

  @integration
  Scenario: Existing back and cancel hooks identify the actual action buttons
    Given a drawer with a Back test id and a Cancel test id
    Then each id lands on its real button, which runs only its own callback once
    And without a Back test id the Back button takes the drawer's id and the suffix back
    And a busy drawer waits on both

  @integration
  Scenario: A secret dialog ignores an outside click but closes by X or Escape
    Given a dialog that does not close on an outside interaction
    Then an outside click requests no close
    And the X requests one close and Escape requests one close
    And the default dialog still closes on an outside click
    And a busy or non-dismissible dialog ignores the outside click either way

  @integration
  Scenario: A footer link is a real anchor that routes in-app only on a plain click
    Given a dialog and a drawer whose action is a link with onActivate and onNavigate
    Then the action is an anchor with the href, and a plain click runs onActivate then onNavigate once
    And native navigation is prevented only when onNavigate is given
    And a modified click, a middle click and a _blank link run neither and stay native
    And a _blank link keeps its rel tokens and adds noopener

  @integration
  Scenario: A busy or unavailable footer link cannot be followed
    Given a link action that is loading, busy or has a disabled reason
    Then it has no href, says aria-disabled and ignores click, middle click and Enter

  @integration
  Scenario: A dialog draws several secondary actions and each carries a tone
    Given a dialog with a secondary action, more secondary actions and a primary action
    Then all are drawn in order before the primary and Cancel is not drawn
    And a toned secondary action draws in its tone's colour

  @integration
  Scenario: A dialog opened from a menu focuses the requested field and returns focus to the trigger
    Given a menu item opens a dialog with initialFocusEl on a reason input and finalFocusEl on the trigger
    Then the reason input has focus at once and typing lands in it
    And Tab stays inside the dialog
    And closing returns focus to the trigger

  @integration
  Scenario: A dialog can keep the card ground it had over a card-toned page
    Given a dialog with ground card and another without
    Then the first draws the card ground and the other keeps the overlay ground

  @integration
  Scenario: A primary action may be neutral or green, and a destroying one stays red
    Given a dialog whose primary action carries the tone success, one with neutral and one with danger
    Then the first is green, the second is the inverse button and the third is red

  @integration
  Scenario: A dialog or drawer footer may be one node that owns its controls
    Given an overlay given footerContent
    Then it draws that node in its one footer band with no extra Cancel
    And a null footerContent draws no band

  @integration
  Scenario: A dialog's Escape and focus options default to the current behaviour
    Given a dialog with closeOnEscape false and another busy dialog with closeOnEscape true
    Then neither closes on Escape and the default dialog still does

  @integration
  Scenario: The detail and wide steps and the content frame are named
    Given a drawer of size detail, one of size wide and one with the content chrome
    Then they are 38.5rem, 59.375rem and a bounded frame with one X and a supplied header

  @integration
  Scenario: A dialog header band, reading height, document width and glass are named
    Given a dialog with headerAppearance muted, heightLimit reading, size document and surface glass
    Then the header band is painted whole, the frame is capped at 85vh, 64rem wide and translucent
    And a glass dialog on the panel ground is refused

  @integration
  Scenario: A dialog can hide its X and name a caller-owned description
    Given a dialog with showCloseButton false and a headerContent with a descriptionId
    Then it draws no X, still closes on Escape and is described by that element

  @integration
  Scenario: A drawer has a workspace width, an Escape guard and a raised footer
    Given a drawer of size workspace with an Escape guard answering false and a raised footer
    Then it is 87.5rem wide, Escape leaves it open until the guard answers true and the footer is opaque

  @integration @browser
  Scenario: A drawer can follow or wait for a companion panel
    Given a drawer given companionMotion follow, another given wait, and one given neither
    Then follow eases the end margin over 240ms
    And wait also delays the entrance 450ms, and neither option leaves the drawer as before

  @integration @browser
  Scenario: A dialog with no field and no Cancel still takes and holds focus
    Given a dialog with a link, tabs and a code preview but no input and no Cancel
    When it opens without a click inside
    Then focus is inside it and Tab and Shift+Tab never leave it
    And an explicit initial target that is unavailable falls back the same way

  @integration
  Scenario: A snippet switching to a grammar not yet loaded shows readable code first
    Given a snippet preview showing Python
    When the same preview switches to Go before Go is loaded
    Then the code reads as plain text at once and is highlighted once Go has loaded
