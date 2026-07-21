Feature: Message translation in the trace details drawer
  As an operator reading traces in a language I don't speak
  I want a Translate action wherever message content renders
  So that I can read conversations without leaving the drawer

  Translation reuses the `translate.translate` mutation (FAST-role model,
  feature key `translate.text`). Model-config failures surface through the
  same typed-error toasts as the legacy messages view: missing model opens
  the missing-model popup, disabled provider and failed calls raise their
  dedicated toasts. Translation state is view-local — nothing persists.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has a FAST model configured

  Rule: Summary tab input/output panels

    Scenario: Translate action in the IOViewer header
      Given the trace drawer is open on the Summary tab
      When the user hovers the Input or Output panel header
      Then a "Translate" action is visible next to Annotate / Suggest edit
      And clicking it translates the panel's content to English

    Scenario: Translated content renders through the same viewer
      Given the Input panel shows chat-shaped content in Portuguese
      When the user clicks "Translate"
      Then the translated content replaces the panel body
      And a "Show original" affordance restores the untranslated content
      And the format toggles (pretty / text / json / markdown) keep working

    Scenario: Translation is cached per panel while the drawer is open
      Given the user already translated the Output panel once
      When they toggle back to the original and translate again
      Then no second network request is made

    Scenario: Chat-shaped content is translated per message
      Given the Input panel shows a chat-shaped conversation
      When the user clicks "Translate"
      Then each message's prose is translated on its own
      And roles, tool calls and structured payloads are left untouched
      And the panel still renders as the same conversation

    Scenario: Stepping to different content resets the translation
      Given a panel is showing translated content
      When the panel's content changes to another trace's
      Then the new original content is shown
      And the action reads "Translate" again

    Scenario: A second click mid-translation does not start another request
      Given a translation request is in flight for a panel
      When the user clicks the action again before it finishes
      Then no additional translation requests are made

  Rule: Conversation tab turns

    Scenario: Per-turn Translate action in the hover action row
      Given the trace drawer is open on the Conversation tab
      When the user hovers a turn
      Then the turn's action row shows a "Translate" action
      And clicking it translates that turn's user and assistant bubbles

    Scenario: Translate action does not require annotation permissions
      Given the user lacks "annotations:manage"
      When they hover a turn
      Then the action row still shows the "Translate" action
      And the annotation actions stay hidden

    Scenario: Toggling a translated turn back
      Given a turn is showing its translation
      When the user clicks the turn's "Translate" action again
      Then the original bubbles are restored without a network request

  Rule: Conversation Context panel

    The compact previous / current / next strip in the trace drawer also has
    a single Translate toggle in its header, so a reader can flip every turn
    preview it shows to English at once.

    Scenario: Translate toggle on the Conversation Context header
      Given the trace drawer shows the Conversation Context panel expanded
      Then its header shows a "Translate" action
      When the user clicks it
      Then every visible turn preview is shown translated to English
      And a "Show original" toggle restores the untranslated previews

    Scenario: The Translate toggle is hidden while the panel is collapsed
      Given the Conversation Context panel is collapsed
      Then no Translate action is shown in its header

  Rule: Failure feedback matches the legacy messages view

    Scenario: No FAST model configured anywhere in the cascade
      Given the project's cascade resolves no FAST model
      When the user clicks any Translate action in the drawer
      Then the missing-model popup prompts them to pick a Fast model in Model Providers settings

    Scenario: Provider call failure raises the AI-call-failed toast
      Given the FAST model resolves but the provider rejects the call
      When the user clicks any Translate action in the drawer
      Then a toast tells them to double-check their Fast model configuration in Model Providers
      And the view returns to the untranslated state
