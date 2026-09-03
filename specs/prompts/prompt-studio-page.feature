Feature: Prompt Studio page
  As a member of a project
  I want the prompts page to open only for readers who may see prompts
  So that a deep link into the studio never shows a project's prompts to someone who cannot read them

  # The address is `/:project/prompts`. It is one page key, one screen, and one
  # grant: the platform page was `withPermissionGuard("prompts:view")` and only
  # the grant travelled when the screen moved into `@langwatch/prompt-web` —
  # the dashboard chrome around it belongs to the route tree.

  @integration
  Scenario: Prompt Studio opens for a reader who may view prompts
    Given I am signed in with the "prompts:view" grant on the project
    When I open the prompts page
    Then the prompt studio is shown

  @integration
  Scenario: Prompt Studio is behind the grant its platform page asked for
    Given I am signed in without the "prompts:view" grant on the project
    When I open the prompts page
    Then the prompt studio is not shown
    And I am told which grant the page needs

  @integration
  Scenario: Replicating a prompt offers only projects the reader may create in
    Given I belong to one team as an administrator and to another as a viewer
    When I open the Replicate dialog on a prompt
    Then only the projects of the team I administer are offered

  @integration
  Scenario: Opening a trace from a playground turn addresses the trace drawer
    Given a playground turn recorded a trace
    When I choose "View Trace" on that turn
    Then the address names the trace drawer and carries the trace it is about
    And no parameter left over from a previously opened drawer remains in the address
