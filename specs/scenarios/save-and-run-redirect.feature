Feature: Save-and-run from the scenario form drawer redirects to /simulations on first click
  As a user composing a new scenario
  I need "Save and Run" to take me straight to /simulations
  So I can watch the run start without manually navigating away from a stale form URL.

  Background: tracking lw#3586 F11. Two competing `router.push` calls used
  to fire after a successful save (closeDrawer's drawer-param cleanup vs
  the simulations redirect). Back-to-back router.push calls get coalesced
  — the cleanup push won and the redirect was silently dropped. The drawer
  also transitioned create → edit-mode mid-save, adding a third competing
  push.

  The fix: pass `skipTransition: true` to handleSave (no create→edit URL
  push) and drop the `onClose()` call (the simulations route swap closes
  the drawer implicitly). After the fix exactly one router.push fires:
  the redirect itself.

  @integration
  Scenario: save-and-run navigates to /simulations from edit mode
    Given an existing scenario open in the form drawer
    When the user clicks Save and Run
    Then router.push is called with /<projectSlug>/simulations?pendingBatch=<id>

  @integration
  Scenario: save-and-run does not call onClose so closeDrawer's router.push can't race the redirect
    Given an existing scenario open in the form drawer
    And an `onClose` prop is provided
    When the user clicks Save and Run
    Then `onClose` is NOT called

  @integration
  Scenario: save-and-run fires exactly one router.push (the simulations redirect)
    Given an existing scenario open in the form drawer
    When the user clicks Save and Run
    Then router.push is called exactly once
    And the single push targets /<projectSlug>/simulations

  @integration
  Scenario: save-and-run navigates to /simulations from create mode
    Given the form drawer is open without a scenarioId (create mode)
    When the user clicks Save and Run
    Then router.push is called with /<projectSlug>/simulations?pendingBatch=<id>

  @integration
  Scenario: save-and-run from create mode does not transition to edit-mode URL
    Given the form drawer is open without a scenarioId (create mode)
    When the user clicks Save and Run
    Then router.push is called exactly once (no edit-mode URL transition)
