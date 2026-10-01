Feature: Personal access token on the onboarding setup screens
  As a new LangWatch user following the manual setup
  I want to create a personal access token from the integration info card
  So that I can paste it into my code without opening the project settings

  # Bound in
  # modules/onboarding/browser/src/ui/sections/__tests__/product-screen.api-key.integration.test.tsx
  # and modules/onboarding/browser/src/behavior/__tests__/onboarding-organization-graph.integration.test.ts.

  @integration
  Scenario: Manual setup offers a personal access token for the project named in the address, shown once
    Given I may mint a key on the project "acme-agent"
    When I open the manual setup with projectSlug "acme-agent"
    Then the integration info card shows "<YOUR_LANGWATCH_API_KEY>" and has minted nothing
    When I click "Create a personal access token"
    Then the host mints a personal key with one member grant on that project
    And the token fills the card, is copied from it, and is held in memory only

  @integration
  Scenario: Manual setup fills in no token when the mint is refused
    Given I may not mint a key on the project "acme-agent"
    When I open the manual setup with projectSlug "acme-agent" and click "Create a personal access token"
    Then the card still shows "<YOUR_LANGWATCH_API_KEY>" and nothing is copied

  @integration
  Scenario: The organization graph carries no project key and keeps each creation time
    Given the organization graph lists two projects
    When the onboarding host reads the graph
    Then it offers no project key
    And each project keeps its creation time, so the newest can be picked when no projectSlug is given

  # Bound in modules/trace/browser/src/behavior/__tests__/trace-host-mount.integration.test.tsx.

  @integration
  Scenario: The shared trace page asks for no key
    Given nobody is signed in
    When the trace explorer mounts for a shared trace
    Then it asks the server for no project key

  @integration
  Scenario: Manual setup drops a token when the signed-in user changes
    Given a personal access token is shown on the manual setup card
    When the signed-in user, the organization or the project changes
    Then the card shows the placeholder again

  @integration
  Scenario: Manual setup drops a token whose mint finishes after the user changed
    Given the reader asked for a personal access token
    And the signed-in user, the organization or the project changes before the mint finishes
    When the mint completes
    Then the card shows the placeholder and no token
