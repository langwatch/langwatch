Feature: Project API key on the onboarding setup screens
  As a new LangWatch user following the manual setup
  I want the integration info card to show my project's API key
  So that I can paste it into my code without opening the project settings

  # Bound in
  # modules/onboarding/browser/src/ui/sections/__tests__/product-screen.api-key.integration.test.tsx
  # and modules/onboarding/browser/src/behavior/__tests__/onboarding-organization-graph.integration.test.ts.

  @integration
  Scenario: Manual setup shows the key of the project named in the address
    Given I may manage the project "acme-agent"
    When I open the manual setup with projectSlug "acme-agent"
    And I click "Show key"
    Then the integration info card shows that project's API key

  @integration
  Scenario: Manual setup shows no key to a reader the server withholds it from
    Given I may not manage the project "acme-agent"
    When I open the manual setup with projectSlug "acme-agent"
    Then the integration info card shows no API key

  @integration
  Scenario: The organization graph keeps each project's key and creation time
    Given the organization graph lists two projects, one key withheld by the server
    When the onboarding host reads the graph
    Then it answers the key of the project the reader may manage
    And it answers no key for the withheld project
    And each project keeps its creation time, so the newest can be picked when no projectSlug is given

  # Bound in modules/trace/browser/src/behavior/__tests__/trace-host-mount.integration.test.tsx.

  @integration
  Scenario: The trace explorer's integrate surfaces get the project's key
    Given I am signed in and may manage the project "acme-agent"
    When the trace explorer mounts for that project
    Then the project it hands the Integrate pane and drawer carries that project's API key

  @integration
  Scenario: The shared trace page asks for no key
    Given nobody is signed in
    When the trace explorer mounts for a shared trace
    Then it asks the server for no project key
