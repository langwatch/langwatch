Feature: Prompt playground surface hierarchy
  As someone working on a prompt
  I want the playground's chrome to name its actions plainly
  So that I can tell what each control does without decoding a badge

  # The playground stacks three surfaces: the page ground the prompts rail sits
  # on, the workspace toolbar that acts on the prompts open in it, and the
  # editor's own header. The scenarios below pin what each of those three says,
  # because the words on a control are the part a person acts on.
  #
  # The editor header carries the model picker, the version history, Deploy,
  # the API snippet and one primary action, and nothing else: a version pill, a
  # scope badge and an activity glyph beside the model select each said
  # something the row already said or the reader could not act on.
  #
  # Implementation:
  #   packages/features/prompt/web/src/screens/prompt-studio/save-prompt-button.tsx
  #   packages/features/prompt/web/src/screens/prompt-studio/fields/editing-mode-title.tsx
  #   packages/features/prompt/web/src/screens/prompt-studio/sidebar/add-prompt-button.tsx
  #   packages/features/prompt/web/src/screens/prompt-studio/browser/prompt-playground-browser.tsx

  Background:
    Given I am authenticated in project "my-project"

  # -- the editor header's primary action -------------------------------------

  @integration
  Scenario: The primary action names the version a save will produce
    Given the prompt is saved at version 2
    And I have edited it without saving
    Then the primary action reads "Update to v3"

  @integration
  Scenario: The primary action is quiet when there is nothing to save
    Given the prompt is at its latest version
    And I have made no edits
    Then the primary action reads "Saved"
    And the primary action is disabled

  @integration
  Scenario: A prompt that was never saved offers a plain save
    Given a prompt that has never been saved
    And I have edited it
    Then the primary action reads "Save"

  # -- the prompt editor's section title --------------------------------------

  @integration
  Scenario: The prompt section is titled for the mode it is in
    When the editor is in the single-instruction mode
    Then the section is titled "Prompt"
    When the editor is in the message-list mode
    Then the section is titled "Messages"

  # -- the workspace toolbar ---------------------------------------------------
  #
  # Comparing and starting a new prompt both act on the workspace rather than on
  # one prompt, so they sit together at the top right of it. Both keep their
  # words while there is room for them, and drop to their marks once a second
  # pane has taken the width.

  @integration
  Scenario: Starting a new prompt is offered from the workspace toolbar
    When I open the playground
    Then the workspace toolbar offers "New Prompt"
