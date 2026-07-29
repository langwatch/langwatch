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
