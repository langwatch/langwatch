Feature: ModelSelector renders an honest empty state when no models are configured
  As a user landing on a freshly created LangWatch project
  I do not want any model picker to render `openai/gpt-5.2` as if it were a real selection
  Because that string is the System fallback for the cascade, not a working model, and clicking through any AI feature with it errors at runtime

  # Old behaviour: ModelSelector rendered the System fallback model id in gray
  # text inside the trigger. The dropdown would open with zero items because
  # `getCustomModels` filters by `provider.enabled === true`. Users saw what
  # looked like a real selection ("openai/gpt-5.2"), picked nothing else, then
  # got a generic provider error the first time the surface tried to call
  # Vercel AI SDK.
  #
  # New behaviour (this feature): when `selectOptions.length === 0`,
  # ModelSelector swaps the trigger for a `NoModelsConfiguredCallout` that
  # links to /settings/model-providers in a NEW TAB. tRPC's focus refetch
  # picks up the freshly configured providers when the user returns to the
  # original surface, so they don't lose context.

  Background:
    Given I am logged in
    And I am on a LangWatch project that has zero enabled model providers

  @integration
  Scenario: Empty picker renders a configure CTA instead of the System fallback model id
    Given I open a surface that renders ModelSelector (Prompt drawer, evaluator drawer, workflow LLM node, etc.)
    When the project has no enabled providers
    Then the ModelSelector trigger is replaced with a NoModelsConfiguredCallout
    And the callout reads "No models configured"
    And the callout shows a "Set up models" button that opens /settings/model-providers in a new tab
    And the dropdown does NOT render the System fallback (e.g. "openai/gpt-5.2") as a selected value

  @integration @unimplemented
  Scenario: Picker recovers automatically when the user configures a provider in another tab
    Given the empty-state callout is showing on a surface
    When the user clicks "Set up models" and configures a provider in the new tab
    And the user returns focus to the original tab
    Then tRPC's focus-refetch re-runs the provider list query
    And ModelSelector re-renders with the newly configured models as selectable options
