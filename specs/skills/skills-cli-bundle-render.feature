@skills
Feature: The CLI bundles the skills render that matches who runs it
  As a developer who installs the LangWatch CLI
  I want the skills it bundles to keep the sign-in steps
  So that `langwatch skills get` tells me how to log in before anything else

  # Each skill is rendered twice into skills/_compiled: `cli` keeps the login
  # partials, `native` drops them because Langy already holds a session key.
  # The CLI build picks one with LANGWATCH_SKILLS_RENDER. The Langy image and
  # the host-tier Langy CLI build set it to native, because Langy's bash tool
  # can run that CLI. specs/langy/langy-native-skills.feature pins Langy's side.

  @unit
  Scenario: Building the CLI without choosing a render bundles the cli render
    Given LANGWATCH_SKILLS_RENDER is not set
    When the CLI's skills bundle is generated
    Then it is built from the cli render

  @unit
  Scenario: The cli render keeps every sign-in step its skills import
    Given the CLI is built with the cli render
    When I read a bundled skill that imports a login partial
    Then the skill still contains that partial's text, including langwatch login

  @unit
  Scenario: The native render leaves the sign-in steps out
    Given the CLI is built with LANGWATCH_SKILLS_RENDER=native
    When I read the bundled setup skill
    Then it does not tell me to run langwatch login

  @unit
  Scenario: The Langy image builds its CLI with the native render
    Given the Langy agent image's build steps
    When it generates the CLI's skills bundle
    Then it sets LANGWATCH_SKILLS_RENDER=native

  @unit
  Scenario: The host-tier Langy CLI is built with the native render
    Given a host-tier Langy stack whose CLI has not been built
    When haven builds that CLI
    Then the build sets LANGWATCH_SKILLS_RENDER=native

  @unit
  Scenario: A host-tier Langy CLI built without the native render is rebuilt
    Given a host-tier Langy stack whose CLI was built without haven's native stamp
    When haven starts that stack
    Then it rebuilds the CLI with LANGWATCH_SKILLS_RENDER=native
    And it stamps the rebuilt CLI as native

  @unit
  Scenario: Building the host-tier Langy CLI leaves the checkout's skills bundle on the cli render
    Given haven builds the host-tier Langy CLI with the native render
    When that build finishes, whether it passes or fails
    Then the checkout's generated skills bundle is regenerated from the cli render
    And the job still reports the build's own exit status

  @unit
  Scenario: An unknown render value fails the build
    Given LANGWATCH_SKILLS_RENDER is set to a value other than cli or native
    When the CLI's skills bundle is generated
    Then the build fails with an error naming the allowed values
