Feature: Test colour variables
  As someone testing a screen that reads a raw colour from the design system
  I want the real semantic colours to resolve in the jsdom test environment
  So that a chart or canvas reading a token renders instead of throwing

  The provider emits the token variables inside a cascade layer that jsdom does not
  compute. The testing subpath installs the same variables from the packaged system.

  @integration
  Scenario: Test colours resolve the real system's semantic variables
    Given the design-system provider is mounted and the test colours are installed
    When a component reads fg.subtle and orange.solid through the raw colour hook
    Then both resolve to literal colours that match the theme's definitions

  @integration
  Scenario: Changing the test mode updates a mounted raw-colour reader
    Given a mounted reader of a semantic colour that differs between modes
    When the test switches to dark through the handle, and back to light
    Then the same mounted reader shows the dark value, then the light value again

  @integration
  Scenario: Disposing test colours restores the previous environment
    Given a body custom property with a priority and a mode class already present
    When the colours are installed, switched and disposed
    Then the original value, priority and class are back and nothing owned remains
    And a following test without the helper does not inherit the tokens

  @integration
  Scenario: Missing colour variables still fail visibly
    Given no test colours are installed
    When a semantic colour or an unknown token is read
    Then the production error is thrown, not caught by the helper
