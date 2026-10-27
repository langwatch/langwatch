Feature: Lent tokens live in their owner's client, wave 3
  Onboarding, organization, project, navigation and Langy lend their components,
  hooks and drawers by tokens declared in their own client packages. A reader
  imports the token from that client and reads it, without importing the owner's
  browser package or naming the capability as a string (ARCHITECTURE.md §10.1).

  @unit
  Scenario: Each wave 3 owner lends by its client tokens
    Given the onboarding, organization, project, navigation and Langy browsers are installed
    When a reader looks up each token from its owner's client
    Then the owner's lent component, hooks or drawer is found for it

  @integration
  Scenario: Project's home renders organization's pending join requests through its client token
    Given organization lends its pending join requests card by token
    When project's home draws the pending join requests in their place
    Then organization's card renders there

  @integration
  Scenario: An uninstalled organization leaves project's home without the join requests card
    Given no installed module lends the pending join requests token
    When project's home draws the pending join requests in their place
    Then nothing renders there and nothing fails

  @integration
  Scenario: Langy's tour card reads onboarding's tour state through its client token
    Given onboarding lends its guided tour state hooks by token
    When Langy's tour card asks whether a tour is running
    Then it reads onboarding's answer

  @integration
  Scenario: An uninstalled onboarding leaves Langy's tour card idle
    Given no installed module lends the guided tour state token
    When Langy's tour card asks whether a tour is running
    Then no tour is running and a replay does nothing

  @integration
  Scenario: Navigation opens organization's create-project drawer by token
    Given organization's create project drawer token
    When a reader picks "New project" for a team in the project menu
    Then the navigation host opens that drawer by token with the team and organization

  @integration
  Scenario: The CLI authorisation screen opens organization's create-project drawer by token
    Given organization's create project drawer token
    When a reader chooses "Create project" on the CLI authorisation screen
    Then the api-key host opens that drawer by token with the organization

  @unit
  Scenario: The shell captures first-touch attribution through onboarding's client token
    Given onboarding lends its first-touch attribution by token
    When the shell resolves its attribution capture
    Then it uses onboarding's capture, and without onboarding it captures nothing
