Feature: Open in Playground from anywhere a prompt is shown in the trace drawer

  Every surface in the v2 trace drawer that mentions a prompt — the chat
  history on an llm span, the span-level Prompt accordion on a
  Prompt.compile / PromptApiService.get span, and the Prompts tab usage
  card — must offer a one-click "Open in Playground" affordance. Behind
  the button the loader smart-defaults: open the linked managed prompt at
  the traced version when one is linked, create a fresh tab from the
  span's input/output otherwise. The chat-side button works even when no
  managed prompt is tied to the call (third-party tracing). When the
  caller points at a non-llm span (Prompt.compile / PromptApiService.get
  / Prompts tab card), the server resolves to the nearest llm in the same
  trace before loading.

  Scenario: Open in Playground on the chat header of any llm span
    Given the user is viewing an llm span in the v2 trace drawer
    When the user looks at the Input panel header
    Then there is an "Open in Playground" action next to Copy / Annotate
    And clicking it opens the playground in a new tab populated with the span's chat history

  Scenario: Smart default opens the linked managed prompt at the traced version
    Given the llm span has langwatch.prompt.id pointing at a managed prompt
    When the user clicks "Open in Playground" on the chat header
    Then the playground tab loads the existing prompt
    And the prompt's system message is in the PROMPT box
    And the trace's chat history is in the Conversation panel
    And the model is set to the model recorded on the span

  Scenario: Smart default creates a fresh tab when no prompt is linked
    Given the llm span has no langwatch.prompt.* attribute
    And no sibling Prompt.compile in the trace exposes one either
    When the user clicks "Open in Playground" on the chat header
    Then the playground tab is labelled "New Prompt"
    And the span's system message lands in the PROMPT box
    And the user / assistant messages land in the Conversation panel
    And the model is set to the model recorded on the span

  Scenario: Open in Playground on a Prompt.compile span resolves to its llm
    Given the user is viewing a Prompt.compile span in the v2 trace drawer
    When the user clicks "Open in Playground" in the Prompt accordion
    Then the playground loads using the nearest llm child or sibling
    And the prompt accordion is populated as if the user had clicked from that llm directly

  Scenario: Resolver falls back to the earliest trace llm when no child or sibling matches
    Given the user is viewing a non-llm span with no llm descendants
    And no sibling llm started at or after the requested span
    When the user clicks "Open in Playground" in the Prompt accordion
    Then the playground loads using the earliest llm in the trace
    And the prompt accordion is populated from that earliest llm's data

  Scenario: Open in Playground on a Prompts tab usage card
    Given the v2 trace drawer's Prompts tab lists at least one prompt usage
    When the user clicks "Open in Playground" on a usage card
    Then the playground loads using the first emitting span of that usage
    And the server resolves the loader's span to the nearest llm in the trace

  Scenario: Playground tab title reflects what was actually opened
    Given the user clicked "Open in Playground" from a span
    When the playground tab finishes loading
    Then the tab title shows the prompt handle when an existing prompt was opened
    And the tab title shows "New Prompt" with an unsaved dot when a fresh tab was created
