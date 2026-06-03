Feature: Adaptive "Set up Langy" modal
  As a project member opening Langy for the first time
  I want a single modal that gets me from "Langy can't run" to "Langy works"
  So that I never hit a dead end when a model isn't configured yet

  # Langy fails today with an HTTP 409 from POST /api/langy/chat when
  # getVercelAIModel(projectId) cannot resolve a model for the DEFAULT role
  # (feature key prompt.create_default). This modal is the recovery surface
  # for that 409: it confirms the dedicated Langy key (already minted in
  # #4273), lets the user pick / confirm a chat model, and persists it as the
  # project's DEFAULT-role default so the next send resolves and streams.

  Background:
    Given I am signed in and Langy is enabled for my account
    And I am a member of a project with permission to use Langy

  # ---------------------------------------------------------------------------
  # Trigger — the modal replaces the dead-end error
  # ---------------------------------------------------------------------------

  @ui
  Scenario: Opening Langy with no model configured opens the setup modal
    Given my project has no usable model provider configured
    When I open Langy and send a message
    Then the "Set up Langy" modal opens instead of a generic error toast

  @ui
  Scenario: The key section is informational, not an action
    When the "Set up Langy" modal is open
    Then it confirms that a dedicated Langy key is ready
    And it does not ask me to create or paste any key

  # ---------------------------------------------------------------------------
  # Model section — the server picks the branch from configured providers
  # ---------------------------------------------------------------------------

  @ui
  Scenario: Branch A — Anthropic already configured
    Given my project has the Anthropic provider enabled
    When the "Set up Langy" modal is open
    Then it offers a one-click "Use Anthropic" action
    And the model dropdown is preset to an Anthropic chat model

  @ui
  Scenario: Branch B — only another provider is configured
    Given my project has only the OpenAI provider enabled
    When the "Set up Langy" modal is open
    Then it offers a one-click "Use your OpenAI" action
    And it shows a soft nudge to add Anthropic for the best experience
    And the model dropdown is preset to an OpenAI chat model

  @ui
  Scenario: Branch C — no provider configured
    Given my project has no model provider configured
    When the "Set up Langy" modal is open
    Then it shows an "Add a model" action that deep-links to Model Providers settings
    And no model can be confirmed until a provider is added

  @ui
  Scenario: Branch C returns to a ready modal after adding a provider
    Given the "Set up Langy" modal is open with no provider configured
    When I add the Anthropic provider in the settings tab and return to Langy
    Then the modal re-checks providers and advances to the "Use Anthropic" action

  @ui
  Scenario: I can pick a different chat model from the dropdown
    Given my project has more than one chat model available
    When the "Set up Langy" modal is open
    And I choose a different model from the dropdown
    Then that model becomes the one that will be confirmed

  @ui
  Scenario: Confirming a model closes the modal and Langy works
    Given my project has the Anthropic provider enabled but no default model
    When I confirm "Use Anthropic" in the "Set up Langy" modal
    Then the modal closes
    And my original message is sent and Langy streams a reply

  # ---------------------------------------------------------------------------
  # The gate — real server behavior the modal must satisfy (real DB)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A project with no default model fails the Langy model gate
    Given a project with no model provider configured
    Then resolving the Langy chat model for that project fails with "not configured"

  @integration
  Scenario: Confirming a model satisfies the Langy model gate
    Given a project with the Anthropic provider enabled but no default model
    When the modal persists the chosen model as the project's default
    Then resolving the Langy chat model for that project returns that model

  @integration
  Scenario: Re-confirming a different model resolves to the latest choice
    Given a project with the Anthropic provider enabled
    When the modal persists a chosen default model
    And the modal later persists a different chosen default model
    Then resolving the Langy chat model returns the most recently chosen one
