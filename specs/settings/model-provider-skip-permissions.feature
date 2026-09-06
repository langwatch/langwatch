Feature: A provider says which models may skip Langy's permission checks
  As an administrator of model providers
  I want to decide which models are trusted to run on a developer's machine without asking
  So that the skip toggle exists only where the model earns it

  # The skip toggle on Langy's permission card
  # (specs/langy/langy-local-permissions.feature) is gated by the model that
  # runs the conversation. Each provider carries a list of model patterns.
  # OpenAI and Anthropic ship a default list of their frontier models; every
  # other provider ships an empty one. See dev/docs/adr/129-langy-local-control.md.

  Background:
    Given I am signed in as an administrator
    And the model provider drawer is open

  Rule: The list lives in the provider's Advanced section

    @integration
    Scenario: The Advanced section holds the allowed models list
      When I open the Advanced section
      Then the section is titled Advanced
      And it has a field for the models allowed to skip Langy permission checks
      And the field takes one pattern per line

    @integration
    Scenario: Saving the list keeps it on the provider
      When I enter two patterns and save
      Then reopening the drawer shows the same two patterns

    @integration
    Scenario: An invalid pattern is rejected on the field
      When I enter a pattern that is not a valid regular expression and save
      Then the field shows which line is invalid
      And nothing is saved

    @integration
    Scenario: Clearing the field restores the provider's default list
      Given I saved a custom list
      When I clear the field and save
      Then the provider uses its default list again
      And the field shows the defaults as placeholder text

  Rule: Defaults trust frontier models only

    @unit
    Scenario: OpenAI's default allows its frontier models and their successors
      Given the OpenAI provider with no custom list
      Then "gpt-5.6-terra" and "gpt-5.6-sol" are allowed
      And "gpt-5.7", "gpt-5.10" and "gpt-6" are allowed
      And "gpt-5.6-luna", "gpt-5.7-mini", "gpt-5-mini" and "gpt-5-nano" are not

    @unit
    Scenario: Anthropic's default allows Opus and Fable from version five on
      Given the Anthropic provider with no custom list
      Then "claude-opus-5", "claude-fable-5-1" and "claude-opus-6" are allowed
      And "claude-sonnet-5", "claude-haiku-4-5" and "claude-opus-4-1" are not

    @unit
    Scenario: Every other provider allows nothing by default
      Given the Azure, Bedrock, Vertex, Gemini and custom providers with no custom list
      Then no model is allowed to skip

  Rule: The gate reads the conversation's model

    @unit
    Scenario: The gate strips the provider prefix before matching
      Given a conversation running on "anthropic/claude-fable-5-1"
      When the gate is asked whether the model may skip
      Then it matches "claude-fable-5-1" against the Anthropic list
      And answers yes

    @unit
    Scenario: A routing handle resolves to the provider and model behind it
      Given a conversation running on a routing handle that points at an allowed model
      When the gate is asked whether the model may skip
      Then it answers yes

    @unit
    Scenario: A custom list replaces the default, it does not extend it
      Given the OpenAI provider with a custom list holding one pattern
      When the gate is asked about a default model outside that pattern
      Then it answers no

  Rule: The list the customer saved is the list the gate reads back

    @integration
    Scenario: A stored list replaces the provider default
      Given the OpenAI provider saved with a custom list of two patterns
      When the provider is read back
      Then it carries those two patterns and not the provider's default

    @integration
    Scenario: Clearing the list returns the provider to its default
      Given the OpenAI provider saved with a custom list
      When the customer clears the list and saves
      Then the provider carries no custom list, so the default applies again
