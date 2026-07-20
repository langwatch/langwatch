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
