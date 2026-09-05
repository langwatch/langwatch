# The coach-mark tour Langy runs over the real product right after the guided
# sign-up lands, and again on request from the "Guided tour" card in the panel.
#
# The tour is deterministic app UI, not agent output: a collaborator cursor
# tagged "(langy)", a spotlight around the current target, and a caption card
# with the step text. Each step reads for `(2800 + words * 330) * 3` ms and
# then advances on its own. Targets are `data-tour` attributes on the real
# navigation and pages; steps that need the page to do something (fold a
# sidebar group, open the virtual key drawer, type its name, submit) go through
# actions the page registers, never through fake modals. The gateway tour
# mints a real virtual key.
#
# State that outlives the page lives on the organization
# (specs/features/onboarding/guided-onboarding-variant.feature); the tour's
# own position is a client store. When the tour ends the spotlight hands the
# screen to the Langy panel and the host queues the kickoff message exactly
# once.
Feature: Guided onboarding tour
  As a user who just picked what to set up
  I want Langy to show me around the parts of the product that matter for my path
  So that I know where things are before Langy starts the real setup in its panel

  Background:
    Given the organization is in the guided onboarding variant
    And the guided state records a current path

  # ============================================================================
  # Step tables, verbatim
  # ============================================================================

  @unit
  Scenario: the LLM Ops tour has four steps over the navigation
    Then the llmops tour targets, in order, "sidebar", "nav-group-build", "product-switcher" and "project-switcher"
    And the product switcher is the icon rail or the product pill in the top bar, whichever the navigation mode shows
    And their texts are:
      | This is the menu: everything you need to fully control your agent lives here.                                     |
      | Here are your prompts, connected agents, evaluators, datasets and all the assets you need to improve your agent. |
      | This is where you switch to different areas of the product, like Gateway, Coding Agent Tracking and Governance.  |
      | And this is how you change between projects, for different teams.                                                |
    And the first three are placed to the right of their target and the last one below it

  @unit
  Scenario: the gateway tour has five steps that mint a key named production-app
    Then the gateway tour targets, in order, "nav-virtual-keys", "gw-new-key", "vk-name", "vk-create" and "vk-secret"
    And their texts are:
      | Here you can see your virtual keys: scoped credentials with budgets and model allowlists. |
      | Let's create your first one right now.                                                    |
      | I'll name it for you.                                                                     |
      | And create it.                                                                            |
      | That's it! I will leave you to save it somewhere safe.                                    |
    And the name typed for the user is "production-app"

  @unit
  Scenario: the governance tour has two steps, the second on the sources page
    Then the governance tour targets, in order, "sidebar" and "main-content"
    And their texts are:
      | Everything here starts from your sources: billing exports, your identity provider, and the AI tools your teams already use.                          |
      | This is where you connect them. Start with your identity provider, then the vendor billing exports: I'll map every tool, seat and dollar from there. |
    And the second step navigates to the governance sources page before the cursor moves

  @unit
  Scenario: the coding path has no tour
    Then the coding tour has no steps
    And the path is reported as having no tour

  @unit
  Scenario: a step reads at three times a slow reading pace
    When the reading time of "And create it." is computed
    Then it is 11370 milliseconds, that is (2800 + 3 words * 330) * 3

  # ============================================================================
  # Running the tour
  # ============================================================================

  @unit
  Scenario: a step auto-advances after its reading time
    Given the llmops tour is on step 1
    When the step's reading time elapses
    Then the tour is on step 2

  @unit
  Scenario: Next advances before the reading time elapses
    Given the llmops tour is on step 1
    When the user clicks Next
    Then the tour is on step 2
    And the step 1 auto-advance never fires

  @unit
  Scenario: the step counter doubles as Back
    Given the llmops tour is on step 2
    When the user clicks the "2 of 4" counter
    Then the tour is on step 1

  @unit
  Scenario: the counter does nothing on the first step
    Given the llmops tour is on step 1
    When the user clicks the "1 of 4" counter
    Then the tour stays on step 1

  @unit
  Scenario: Skip ends the tour as skipped
    Given the llmops tour is on step 2
    When the user clicks Skip
    Then the tour ends with the status "skipped"

  @unit
  Scenario: Next on the last step ends the tour as completed
    Given the llmops tour is on its last step
    When the user clicks Next
    Then the tour ends with the status "completed"

  @unit
  Scenario: the first cursor placement is instant and later moves take 850 milliseconds
    Given the llmops tour starts
    Then the cursor appears on its first target with no transition
    When the tour moves to step 2
    Then the cursor moves to the new target over 850 milliseconds

  @unit
  Scenario: the spotlight is re-measured after the target grows
    Given the llmops tour is on the Build step
    When the cursor arrives and the Build group expands
    Then the spotlight is measured again and covers the whole expanded group

  @unit
  Scenario: the spotlight follows a target that moves while the caption is up
    Given the gateway tour is on the name field step
    And the create drawer is still sliding in when the field is first measured
    When the cursor arrives and the field is measured again
    Then the spotlight, the cursor and the caption take where the field is now
    When the drawer keeps sliding while the caption is up
    Then they follow it to where the field ended up

  @unit
  Scenario: Build folds before the first step and is restored at the end
    Given the Build group was expanded before the tour
    When the llmops tour starts
    Then the Build group is collapsed for the first step
    And it expands when the cursor lands on it
    And it folds again for the product switcher step
    When the tour ends
    Then the Build group is back to how it was before the tour

  @unit
  Scenario: Build was collapsed before the tour and stays collapsed after it
    Given the Build group was collapsed before the tour
    When the llmops tour runs to the end
    Then the Build group is collapsed again after the tour

  @unit
  Scenario: a missing target skips its step
    Given the gateway tour is on the "nav-virtual-keys" step
    And no element on the page carries that tour target
    When the step tries to measure its target
    Then the tour keeps looking for it for four seconds
    And then moves on to the next step

  @unit
  Scenario: a target that is still loading is waited for
    Given the llmops tour is on the "sidebar" step
    And the sidebar is still loading
    When the sidebar mounts two seconds later
    Then the cursor lands on it and the step goes on as usual

  @unit
  Scenario: a target hidden by a flag or a permission is a missing target
    Given the gateway menu is hidden by its release flag
    When the gateway tour runs
    Then the virtual keys step is skipped rather than stranding the tour

  # ============================================================================
  # Actions the pages register
  # ============================================================================

  @unit
  Scenario: a page registers tour actions on mount and removes them on unmount
    Given the virtual keys page registers "openVirtualKeyCreate"
    When the page unmounts
    Then the action is no longer registered

  @unit
  Scenario: the gateway tour opens the real create drawer, types the name and submits it
    Given the gateway tour is running on the virtual keys page
    When the cursor lands on the New key button
    Then the caption points at it with the drawer still closed
    When the tour leaves that step
    Then the create drawer opens through the page's registered action
    And the name field is measured once the drawer has mounted
    When the cursor lands on the name field
    Then "production-app" is typed into it one character at a time
    When the cursor lands on Create
    Then the drawer's own submit runs, so the key is created for real

  @unit
  Scenario: the secret step reveals the secret
    Given the create request was sent by the previous step
    Then the secret step waits up to fifteen seconds for the key to be created
    When the cursor lands on the secret
    Then the secret is revealed rather than masked

  # ============================================================================
  # Handoff to the panel
  # ============================================================================

  @unit
  Scenario: the spotlight slides onto the panel when the tour ends
    Given the llmops tour is on its last step
    When the tour ends
    Then the cursor and the caption disappear
    And the spotlight moves onto the Langy panel with the rest of the screen dimmed to 0.5
    And after 4600 milliseconds the dim starts fading
    And 1000 milliseconds later the spotlight is gone

  @unit
  Scenario: the handoff spotlight sits below the panel and above the page
    When the spotlight is on the panel
    Then its stacking order is below the panel's own
    And during the tour it is above the drawer layer

  @unit
  Scenario: the kickoff is queued exactly once when the tour ends
    Given the llmops tour is running
    When the tour ends
    Then the tour status is recorded on the organization
    And one kickoff carrying the path, the picks, the provider, the organization name, the first name and the tour status is queued for the panel

  @unit
  Scenario: the coding path queues the kickoff with no tour
    Given the current path is coding
    When the host mounts
    Then no tour runs
    And the kickoff is queued with the tour status "none"

  @unit
  Scenario: a reload after the tour queues the kickoff again only while no conversation is attached
    Given the tour was completed and no conversation is attached
    When the host mounts
    Then no tour runs
    And the kickoff is queued
    Given a conversation is attached
    When the host mounts
    Then nothing is queued

  @unit
  Scenario: the tour never runs twice for the same path
    Given the tour was completed for the current path
    When the host mounts
    Then no tour runs

  @unit
  Scenario: the host opens the panel docked before the tour starts
    When the host starts the tour
    Then the Langy panel is open in sidebar mode

  @unit
  Scenario: the tour never runs on the onboarding screens
    Given the page is under /onboarding
    When the host mounts
    Then no tour runs and nothing is queued

  @unit
  Scenario: the classic variant never runs the tour
    Given the organization is not in the guided onboarding variant
    When the host mounts
    Then no tour runs and nothing is queued

  # ============================================================================
  # Replay from the card
  # ============================================================================

  @unit
  Scenario: replay from the card runs the tour from step 1
    Given the tour was completed
    When the card asks for a replay
    Then the tour runs again from step 1
    And no kickoff is queued when it ends

  # ============================================================================
  # Analytics
  # ============================================================================

  @unit
  Scenario: the tour emits its events under the guided onboarding boundary
    When the llmops tour starts, shows a step, advances, goes back, and ends
    Then "started tour", "viewed tour_step", "clicked tour_next", "clicked tour_back" and "completed tour" are emitted
    And each carries the path, the step carries its index and target, and the completion carries the duration
    And Skip emits "clicked tour_skip"
    And a replay emits "replayed tour"
