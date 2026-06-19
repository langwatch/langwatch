Feature: Model cost regex matching spans preview
  As a project member defining a custom LLM model cost rule
  I want to see which recent spans my regex would match while I type it
  So that I can build the right regex without guessing how my models are recorded

  Background:
    Given I have the LLM model cost drawer open

  @integration
  Scenario: Recent spans matching the regex are listed with tokens and an example cost
    Given my project has recent LLM spans for model "bedrock/eu.anthropic.claude-sonnet-4-6"
    When I type a regex that matches that model
    And I have entered input and output costs per token
    Then I see a list of recent spans that the regex matches
    And each row shows the span's model, token counts, and an example cost computed from my entered rates and that span's tokens

  @integration
  Scenario: Matching follows the same fallbacks as cost computation
    Given my project has recent LLM spans for model "eu.anthropic.claude-sonnet-4-6-v1:0"
    When I type the regex "anthropic/claude-sonnet-4-6"
    Then the span is listed as a match
    # the cost pipeline normalizes Bedrock-style ids before matching, and the
    # preview must agree with what the pipeline would actually do

  @integration
  Scenario: A span row opens the trace details drawer in a new tab
    Given the preview lists a matching span
    When I click that span row
    Then the trace details drawer for that span's trace opens in a new tab
    And the clicked span is the selected span in that drawer

  @integration
  Scenario: No matches shows the models that were seen instead
    Given my project has recent LLM spans for model "eu.anthropic.claude-sonnet-4-6-v1:0"
    When I type a regex that matches none of my recent spans
    Then I see that zero spans matched
    And I see the model names recently seen in my project that did not match
    When I click one of those model names
    Then the regex field is filled with an exact-match regex for that model

  @integration
  Scenario: Slashes in the regex are valid
    When I type the regex "^bedrock/eu\.anthropic\.claude-sonnet-4-6$"
    Then the regex is accepted as valid
    And spans whose model is "bedrock/eu.anthropic.claude-sonnet-4-6" are listed as matches
    # an unescaped forward slash is valid in a regular expression pattern;
    # only regex literals in source code need it escaped

  @integration
  Scenario: Preview is scoped to the current project
    Given another project has spans whose model my regex matches
    Then those spans never appear in my preview
