@unit
Feature: Signal-focused home rollout
  As a returning project member
  I want the signal-focused home rolled out on its own switch
  So that the homepage redesign reaches users independently of the Langy
  assistant's own rollout

  The homepage has three compositions, resolved in a strict order: the
  signal-focused home — the briefing sheet leads, the chrome grid and recent
  work follow — wins outright whenever its rollout is on. Otherwise the Langy
  home renders, when the reader both has Langy and has its own rollout. The
  classic home — banners, the traces overview, recent work, onboarding — is
  the fallback.

  This rollout is therefore the FIRST question the page asks, and it is never
  decided by Langy access: a reader with Langy but without this rollout does
  not get the signal-focused home. Inside the signal-focused composition,
  Langy access decides exactly one thing: whether the sheet's hand-to-Langy
  affordances render. The Langy home's own rollout is specified in
  specs/home/langy-home.feature.

  Scenario: The rollout decides the composition, not Langy
    Given the signal-focused home is enabled for me
    But I do not have Langy
    When the home page renders
    Then the briefing sheet leads the page
    And the classic traces overview and onboarding checklist are not shown

  Scenario: The signal-focused home outranks the Langy home
    Given the signal-focused home is enabled for me
    And I have Langy with its home enabled for me
    When the home page renders
    Then the briefing sheet leads the page
    And the Langy home is not shown

  Scenario: Langy alone does not switch the home
    Given I have Langy
    But neither the signal-focused home nor the Langy home is enabled for me
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

  # Which home a reader gets is decided by feature flags, and a flag that has
  # not answered yet is not the same as a flag that is off. Rendering a home on
  # the assumption of "off" means rendering the wrong one and replacing it a
  # beat later — the reader watches their home change shape on every cold load.
  Scenario: The page waits rather than guessing which home it is
    Given I am loading the home page
    And the rollout flags that decide the composition have not answered yet
    When the page renders
    Then a single neutral placeholder renders in place of the home
    And no composition is rendered
    And the placeholder is announced as loading

  Scenario: The decided home replaces the placeholder once, and never swaps again
    Given I am loading the home page
    And the placeholder is showing
    When every flag the composition depends on has answered
    Then the home it resolved to renders
    And no other composition was rendered first

  # Waiting on a question whose answer cannot change the outcome is just a
  # slower page.
  Scenario: The page only waits on flags that could change the answer
    Given I am loading the home page
    And the signal-focused rollout is enabled for me
    When the signal-focused home wins the precedence
    Then the page does not wait on the Langy rollout to render

  Scenario: A reader with no project never waits on a flag that cannot answer
    Given I am loading the home page
    But I have no project
    When the page renders
    Then the classic home renders without waiting
