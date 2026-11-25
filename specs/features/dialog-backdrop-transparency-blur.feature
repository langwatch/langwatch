Feature: Dialog backdrop transparency and blur
  As a user
  I want dialogs to use only a backdrop blur and never a dark grey overlay
  So that the content behind stays visible and the dialog feels lightweight

  # Pair with drawer-backdrop-transparency-blur.feature. The design system's
  # Dialog (packages/design-system/src/components/overlays/views/dialog-view.tsx)
  # forces the backdrop to render with backdrop-filter blur + a transparent
  # background, drops any caller `bg` on `backdropProps`, and exposes no
  # Backdrop sub-component, so the dark Chakra default cannot come back.

  Background:
    Given the application is loaded

  @integration
  Scenario: Dialog backdrop renders with blur and no dark fill
    When a dialog opens
    Then the dialog backdrop has a backdrop-filter with blur
    And the dialog backdrop background is transparent

  @integration
  Scenario: Caller cannot override the backdrop with a dark fill
    When a dialog opens with backdropProps that try to set a dark background
    Then the dialog backdrop background is still transparent

  @integration
  Scenario: Dialog.Backdrop is not exposed as a public sub-component
    When importing the Dialog namespace from the wrapper
    Then it does not expose a Backdrop sub-component
