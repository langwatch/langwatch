Feature: Model Providers before the organization has its first project
  As someone whose organization was set up to track AI coding agents
  I want to add a model provider straight away
  So that the gateway can route on day one, with no detour through project creation

  # A model provider is an organization resource. The row is anchored to one
  # organization and its reach is the set of scopes attached to it:
  # organization, team, or project. A project is one of the three places a
  # provider can reach, never where it is stored, so nothing on the write
  # path needs one to exist.
  #
  # An organization set up on the agent-governance track can reach Settings
  # before it has a project (ADR-038 v6,
  # specs/features/onboarding/intent-fork.feature), and organization scope is
  # the default for a new credential, so this is the common case rather than
  # an edge case.
  #
  # Pairs with:
  #   - specs/model-providers/provider-list.feature (the page once a project exists)
  #   - specs/model-providers/scope-and-multi-instance.feature (the scope model)

  Background:
    Given I am logged in
    And my organization has no project yet
    And I can manage model providers for my organization

  Rule: adding an organization-scoped provider works with no project

    @integration
    Scenario: Landing on Model Providers without a project
      When I open the Model Providers settings page
      Then I am invited to add my first model provider
      And I am not told to create a project first

    @integration
    Scenario: The add action is available
      When I open the Model Providers settings page
      Then the "Add Model Provider" action is available
      And it carries no blocked reason

    @integration
    Scenario: Picking a provider opens its setup
      When I open the Model Providers settings page
      And I pick a provider to add
      Then the setup for that provider opens
      And it is set up for my organization

    @integration
    Scenario: Saving the credential stores it against the organization
      Given I am setting up a provider for my organization
      When I save it
      Then the provider is stored against my organization
      And it is reachable at organization scope
      And no project had to exist for it

    @integration
    Scenario: The saved provider shows the organization it belongs to
      Given I have added a provider for my organization
      When I open the Model Providers settings page
      Then I see the provider in the list
      And its scope reads as my organization

  Rule: an organization-scoped provider stays manageable without a project

    @integration
    Scenario: Editing it
      Given I have added a provider for my organization
      When I open the Model Providers settings page
      Then its edit and delete actions are available

    @integration
    Scenario: Changing the credential on it
      Given I have added a provider for my organization
      When I change its name and save
      Then the change is stored
      And the same provider row is updated rather than a second one created

    @integration
    Scenario: Deleting it
      Given I have added a provider for my organization
      When I delete the provider
      Then the provider is gone

  Rule: a scope I cannot manage is still refused

    @integration
    Scenario: Someone who cannot manage model providers
      Given I cannot manage model providers for my organization
      When I open the Model Providers settings page
      Then the "Add Model Provider" action is unavailable
      And it explains that I need model provider manage permissions

    @integration
    Scenario: Adding a provider for an organization I do not manage
      Given I am setting up a provider for an organization I cannot manage
      When I save it
      Then the save is refused
      And no provider is stored

    @integration
    Scenario: Assigning a provider to a scope I do not control
      Given I am setting up a provider for my organization
      When I also assign it to a team I cannot manage
      And I save it
      Then the whole save is refused
      And no provider is stored

  # Checking a credential sends it to the address it belongs to, and for a
  # custom provider the customer supplies that address. Nothing after this
  # point re-checks who asked, so being allowed to check a credential has to
  # mean the same thing as being allowed to store one: belonging to the
  # organization is not enough, or anyone with a read-only seat could aim
  # the check wherever they liked.
  Rule: checking a credential is only for someone who could store it

    @integration
    Scenario: A read-only member cannot probe an arbitrary URL
      Given I can only view my organization
      When I ask to check a credential against an address I chose
      Then I am refused
      And nothing is sent to that address

    @integration
    Scenario: Checking a credential for a scope I can manage
      Given I can manage model providers for my organization
      When I ask to check a credential for my organization
      Then the credential is checked
