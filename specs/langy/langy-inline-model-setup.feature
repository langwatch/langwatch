Feature: Langy prompts for a model when the project has none configured
  As a new user opening Langy on a fresh project,
  I want to add a model provider key directly inside Langy,
  so that Langy works immediately without hunting through settings.

  # Langy's chat route resolves a model from the project's default for the
  # gate feature. With nothing configured it returns "no model configured",
  # which previously surfaced only as a toast over a dead composer. Now the
  # panel offers an inline setup that writes both the provider key and the
  # project default model, unblocking Langy in place — no page reload, no
  # detour to settings.

  @integration
  Scenario: Langy shows an inline model setup when no model is configured
    Given a project with no model provider configured
    When the user opens the Langy panel
    Then the panel shows a prompt to add a model provider
    And the user can choose a provider and enter an API key without leaving Langy

  # The panel is a narrow column, so the setup is the compact one: small provider
  # marks and the credentials the chosen provider needs. Naming, scope and
  # advanced settings stay in Settings; the save lands at the widest scope the
  # user manages.
  @integration
  Scenario: The inline setup offers provider marks with Codex first and recommended
    Given the Langy panel is showing the inline model setup
    Then the providers show as small marks, Codex first with a Recommended badge
    And Codex is selected, offering its sign-in
    When the user picks OpenAI
    Then the setup asks for the OpenAI credentials

  @integration
  Scenario: The inline setup asks only for credentials and a default chat model
    Given the inline setup shows an API key provider
    Then it asks for the provider's credentials and a default chat model
    And it does not ask for a name, a scope or advanced settings
    When the user enters a key, picks a chat model and saves
    Then the provider is saved at the organization
    And the picked model becomes the default model

  @integration
  Scenario: Saving a key and default model from Langy unblocks the assistant
    Given the Langy panel is showing the inline model setup
    When the user enters a valid provider API key
    And selects a default chat model
    And saves
    Then Langy stops showing the setup prompt
    And Langy becomes usable without a page reload

  @integration
  Scenario: Langy skips the setup prompt when a model already resolves
    Given a project that already has a default model configured
    When the user opens the Langy panel
    Then the panel shows its normal empty state
    And no model setup prompt is shown

  # A failed lookup used to be indistinguishable from a project that has no
  # model at all, so a momentary failure replaced the user's open conversation
  # with the onboarding grid — and nothing brought the transcript back until a
  # full page reload.
  @integration
  Scenario: A failed model lookup does not masquerade as a missing model
    Given the project's configured model cannot be determined
    When the user opens the Langy panel
    Then the inline model setup is not shown
    And the conversation surface is left intact

  # A page can hand Langy a question ("Ask Langy to set it up"). With no model
  # configured the server refuses the turn, so the question stays queued behind
  # the setup prompt and is sent once a model resolves.
  @integration
  Scenario: A question handed to Langy waits for a model instead of failing
    Given a project with no model provider configured
    When a page opens Langy with a question
    Then the panel shows a prompt to add a model provider
    And the question is not sent
    And the question is shown above the prompt, with a line saying it is sent once a model is set up
    When a model resolves for the project
    Then the question is sent once

  # A guided onboarding whose provider step was skipped reaches the panel with
  # no model. The tour plays first; the setup comes after it as Langy's own
  # message in the conversation, never over it
  # (specs/features/onboarding/guided-tour.feature).
  @integration
  Scenario: The model setup waits while the guided tour plays
    Given a project with no model provider configured
    And the guided tour is running
    When the panel renders
    Then it shows the tour card reading "Doing guided tour"
    And no model setup is shown

  @integration
  Scenario: After the tour Langy asks for a model inline, below the tour card
    Given a project with no model provider configured
    And the tour has ended and the guided kickoff waits to send
    When the panel renders
    Then the tour card stays at the top of the conversation
    And below it Langy says "Now connect me to a model provider so I can integrate your app and start creating evals for you."
    And the provider setup sits in that message, with a "Later" button
    And the full-panel "Langy needs a model to get started" setup is not shown

  @integration
  Scenario: Connecting a provider from the guided prompt sends the kickoff
    Given Langy is asking for a model below the tour card
    When the user saves a provider key and a default chat model
    Then the prompt goes away
    And the guided kickoff is sent once

  @integration
  Scenario: Later puts the guided model prompt away for good
    Given Langy is asking for a model below the tour card
    When the user presses "Later"
    Then the organization's guided onboarding records that the prompt was put off
    And the guided kickoff is dropped without being sent
    And the panel closes
