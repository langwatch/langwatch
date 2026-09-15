Feature: A drawer that needs another drawer
  As someone editing in a drawer who has to go and make something first
  I want the second drawer to take me there and bring me back
  So that the work I had already done is still there when I return

  Drawers are URL-routed singletons: `?drawer.open=<name>` plus one
  `drawer.<key>` per parameter, resolved through the application's registry, and
  ONE drawer is mounted at a time (dev/docs/best_practices/drawers.md). A step
  that needs another drawer therefore NAVIGATES to it and returns — `openDrawer`
  pushes onto the drawer stack, and `goBack` restores the caller with its
  address. It is not a second `Drawer.Root` mounted from `useState` inside the
  first: that stacks an overlay the hook's history knows nothing about, so the
  browser's back button, a pasted link and the caller's own return all disagree
  about what is on screen.

  This file said the opposite until it was rewritten. Its premise was "child
  drawers are rendered via local React state within the parent drawer
  component, NOT via URL navigation" — the exact shape the drawers doc names as
  the thing never to do — and every scenario in it was `@unimplemented`, so it
  enforced nothing while reading as a decision somebody had taken.

  Rule: The sub-flow is a navigation, and the caller is what it returns to

    `openDrawer` pushes; `goBack` pops back to the caller with the parameters
    its address carried. The push UNMOUNTS the caller exactly as closing it
    does, which is why a draft belongs in a store that outlives the component
    rather than in its own state.

    @integration
    Scenario: Going back from a sub-flow returns to the drawer that opened it
      Given a reader who walked from one drawer into another
      When they go back
      Then the first drawer is on screen again with the parameters it was opened with

    @integration @unimplemented
    Scenario: A sub-flow is a navigation rather than a second overlay
      Given a drawer with a step that needs another drawer
      When the reader takes that step
      Then the address names the second drawer
      And only one drawer is mounted

    @integration @unimplemented
    Scenario: The caller's unsaved work survives the walk into a sub-flow and back
      Given a reader has filled in part of a drawer
      When they open a sub-flow from it and come back without saving
      Then what they had already entered is still there

  Rule: The caller decides how the sub-flow ends

    A target that calls `closeDrawer` clears the whole navigation stack, and
    takes the caller down with it. So a caller passes `onClose: goBack`, and a
    target reaches for `closeDrawer` only when it was handed no ending at all —
    which is the case where there is no caller to return to.

    @integration
    Scenario: A drawer the framework cannot let close itself is handed the close to call
      Given a drawer registered in the application's own registry
      When the address opens it
      Then it is given the close to call rather than left to close the stack

    # The other half of the same rule, from the link-follower's side, is
    # specs/navigation/drawer-opened-with-no-caller.feature: that file is about
    # the WORK still finishing, and this scenario is about which ending runs.
    @integration
    Scenario: A sub-flow target with no caller closes the drawer itself
      Given a drawer opened from an address that named no caller
      When it finishes its work
      Then it closes the drawer rather than returning to a caller that is not there

    @integration @unimplemented
    Scenario: Pressing Escape in a sub-flow returns to the caller
      Given a reader is in a sub-flow opened from another drawer
      When they press Escape
      Then they are back in the drawer that opened it, not on the page behind it
