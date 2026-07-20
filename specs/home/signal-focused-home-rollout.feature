@unit
Feature: Signal-focused home rollout
  As a returning project member
  I want the signal-focused home rolled out on its own switch
  So that the homepage redesign reaches users independently of the Langy
  assistant's own rollout

  The homepage has exactly two compositions: the signal-focused home — the
  briefing sheet leads, the chrome grid and recent work follow — and the
  classic home — banners, the traces overview, recent work, onboarding.
  Which one renders is decided only by the signal-focused-home rollout,
  never by Langy access. Langy access decides exactly one thing inside the
  page: whether the sheet's hand-to-Langy affordances render.

  Scenario: The rollout decides the composition, not Langy
    Given the signal-focused home is enabled for me
    But I do not have Langy
    When the home page renders
    Then the briefing sheet leads the page
    And the classic traces overview and onboarding checklist are not shown

  Scenario: Langy alone no longer switches the home
    Given I have Langy
    But the signal-focused home is not enabled for me
    When the home page renders
    Then the classic home renders with banners, the traces overview, recent items, and onboarding
    And the Langy panel itself stays available

  Scenario: Without Langy the sheet keeps working, quietly
    Given the signal-focused home is enabled for me
    But I do not have Langy
    When the briefing sheet renders
    Then each attention-inbox row still opens its Trace Explorer evidence
    And no control offers to hand a signal to Langy
    And the ask row and its suggestion chips are not shown

  Scenario: With Langy the sheet keeps its hand-offs
    Given the signal-focused home is enabled for me
    And I have Langy
    When the briefing sheet renders
    Then each attention-inbox row can hand its evidence to Langy
    And the ask row opens Langy with the composer focused

  Scenario: The quiet invitation adapts to Langy's absence
    Given the signal-focused home is enabled for me
    But I do not have Langy
    And the project is quiet
    When the briefing sheet renders its invitation
    Then the typed first step opens the feature surface that teaches it
    And no action offers to do it with Langy
