Feature: Model Providers before the organization has its first project
  As someone whose organization was set up to track AI coding agents
  I want the Model Providers page to tell me what is missing and let me fix it there
  So that adding my first provider is never a dead end

  # An organization set up on the agent-governance track has no project until
  # the customer needs one (ADR-038 v6, specs/features/onboarding/intent-fork.feature).
  # Settings is reachable from day one, so this page has to hold up before any
  # project exists: a model provider is always set up inside a project.
  #
  # Pairs with:
  #   - specs/model-providers/provider-list.feature (the page once a project exists)
  #   - specs/features/onboarding/primary-use-setting.feature (the other place
  #     the customer is offered their first project)

  Background:
    Given I am logged in
    And my organization has no project yet
    And I can manage model providers

  Rule: the page states what is missing instead of offering actions that cannot work

    @integration
    Scenario: Landing on Model Providers without a project
      When I open the Model Providers settings page
      Then I am told a project comes first
      And I am offered a way to create my first project

    @integration
    Scenario: Adding a model provider is unavailable, with the reason on it
      When I open the Model Providers settings page
      Then the "Add Model Provider" action is unavailable
      And it explains that a project comes first

    @integration
    Scenario: No provider list opens onto choices that do nothing
      When I open the Model Providers settings page
      And I try to add a model provider
      Then no list of providers to pick from opens

    @integration
    Scenario: Providers already visible to the organization cannot be edited or deleted
      Given a model provider is already visible to my organization
      When I open the Model Providers settings page
      Then I see the provider in the list
      And its edit and delete actions are unavailable
      And they explain that a project comes first

  Rule: the first project is created right where the customer hit the wall

    @integration
    Scenario: Creating the first project from the Model Providers page
      Given I am on the Model Providers settings page
      When I choose to create my first project
      Then the project creation form opens
      And it starts out creating the project in my organization's shared team

    @integration
    Scenario: Adding a provider works once the project exists
      Given my organization has a project
      When I open the Model Providers settings page
      And I pick a provider to add
      Then the setup for that provider opens

  Rule: someone who cannot create projects is not sent down a path they cannot finish

    @integration
    Scenario: A member who cannot create projects
      Given I cannot create projects
      When I open the Model Providers settings page
      Then I am told a project comes first
      And creating a project is unavailable, with the reason on it
