# Prompt Facets — Gherkin Spec
# Based on PRD-023: Prompt Facets
# Covers: ingest-time projection, span back-references, sidebar facet rendering,
# query-language fields, autocomplete, edge cases.

Feature: Prompt facets in traces v2
  Promote prompt identity from raw span attributes to first-class trace facets so
  users can filter by selected prompt, last-used prompt, and prompt version
  without writing metadata queries. Each facet records the span it was
  derived from so the drawer can deep-link from a facet hit to the source.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user is on the traces v2 page

  # ───────────────────────────────────────────────────────────────────────────
  # DERIVATION (ingest-time projection from span attributes)
  # ───────────────────────────────────────────────────────────────────────────

  Scenario: Selected prompt is taken from the latest span carrying the attribute
    Given a trace has three spans
    And span 1 has "langwatch.prompt.selected.id" = "support-bot"
    And span 2 has no prompt attributes
    And span 3 has "langwatch.prompt.selected.id" = "billing-bot"
    When the trace summary is built
    Then "trace_summaries.SelectedPromptId" is "billing-bot"
    And "trace_summaries.SelectedPromptSpanId" is the SpanId of span 3

  Scenario: Last-used prompt is taken from the latest span with langwatch.prompt.id
    Given a trace has two spans
    And span 1 has "langwatch.prompt.id" = "support-bot:3"
    And span 2 has "langwatch.prompt.id" = "support-bot:5"
    When the trace summary is built
    Then "trace_summaries.LastUsedPromptId" is "support-bot"
    And "trace_summaries.LastUsedPromptVersionNumber" is 5
    And "trace_summaries.LastUsedPromptSpanId" is the SpanId of span 2

  Scenario: Falls back to langwatch.prompt.handle when langwatch.prompt.id is absent
    Given a trace's latest prompt-bearing span has "langwatch.prompt.handle" = "support-bot"
    And the same span has "langwatch.prompt.version.number" = "2"
    When the trace summary is built
    Then "trace_summaries.LastUsedPromptId" is "support-bot"
    And "trace_summaries.LastUsedPromptVersionNumber" is 2

  Scenario: No prompt attributes leaves all prompt fields null
    Given a trace has spans but no prompt attributes anywhere
    When the trace summary is built
    Then "SelectedPromptId", "SelectedPromptSpanId",
         "LastUsedPromptId", "LastUsedPromptVersionNumber",
         "LastUsedPromptVersionId", "LastUsedPromptSpanId" are all null
    And "ContainsPrompt" is false

  Scenario: ContainsPrompt is true when any prompt attribute is present
    Given a trace's only prompt-bearing span has "langwatch.prompt.id" = "support-bot:1"
    When the trace summary is built
    Then "ContainsPrompt" is true

  Scenario: Selected prompt and last-used prompt may diverge
    Given a trace's latest span carrying "langwatch.prompt.selected.id" sets it to "billing-bot"
    And a later span carries "langwatch.prompt.id" = "fallback-bot:1"
    When the trace summary is built
    Then "SelectedPromptId" is "billing-bot"
    And "LastUsedPromptId" is "fallback-bot"
    And "SelectedPromptSpanId" and "LastUsedPromptSpanId" are different

  # ───────────────────────────────────────────────────────────────────────────
  # SIDEBAR FACETS
  # ───────────────────────────────────────────────────────────────────────────

  Scenario: Prompts group is visible above Metrics in the sidebar
    When the filter sidebar renders
    Then a "Prompts" group is shown
    And it contains "Selected prompt", "Last used prompt", "Prompt version" sections

  Scenario: Selecting a value in Selected prompt narrows the result set
    Given the project has traces with selected prompt "support-bot" and "billing-bot"
    When the user clicks "support-bot" inside the "Selected prompt" facet
    Then the query bar shows "selectedPrompt:support-bot"
    And the trace list shows only traces whose SelectedPromptId equals "support-bot"

  Scenario: Prompt version is range-typed and supports comparison
    When the user types "promptVersion:>=3" into the search bar
    Then the query parses without error
    And only traces with LastUsedPromptVersionNumber >= 3 are returned

  Scenario: Drawer opens to the source span when a facet hit is clicked
    Given the user is viewing the "Selected prompt" facet
    And a trace shows up under handle "billing-bot"
    When the user opens that trace's drawer
    Then the span identified by "SelectedPromptSpanId" is selected by default

  # ───────────────────────────────────────────────────────────────────────────
  # QUERY LANGUAGE
  # ───────────────────────────────────────────────────────────────────────────

  Scenario Outline: Prompt query fields parse and execute
    When the user enters "<query>" in the search bar
    Then the query parses
    And the result set matches the documented backend filter for "<facetField>"

    Examples:
      | query                          | facetField                  |
      | selectedPrompt:billing-bot     | SelectedPromptId            |
      | lastUsedPrompt:support-bot     | LastUsedPromptId            |
      | promptVersion:5                | LastUsedPromptVersionNumber |
      | promptVersion:[3 TO 7]         | LastUsedPromptVersionNumber |
      | -selectedPrompt:billing-bot    | SelectedPromptId (negated)  |

  Scenario: Autocomplete suggests known prompt handles
    Given the project has prompts "support-bot", "billing-bot", "onboarding-bot"
    When the user types "selectedPrompt:" in the search bar
    Then the suggestion dropdown lists those three handles, alphabetically

  # ───────────────────────────────────────────────────────────────────────────
  # BACK-COMPAT
  # ───────────────────────────────────────────────────────────────────────────

  Scenario: Legacy prompt: field still works
    When the user enters "prompt:support-bot"
    Then the query continues to match the existing metadata.prompt_ids array
    And no error is shown
