Feature: Set up with AI from every empty page
  Each feature page's empty state carries its own set-up-with-AI control, fed
  by that surface's own docs skill. Every surface offers the same three
  routes: hand the job to Langy (who has the skills loaded), copy that
  skill into the reader's own coding agent, or read that feature's docs.
  The home keeps its own onboarding control too (a new project lands there
  first), specified in specs/home/langy-home.feature.

  Background:
    Given a project with no data on the surface being visited

  @integration
  Scenario Outline: Every empty surface offers its own skill
    When I open the <surface> page with no <surface> yet
    Then the empty state shows a set-up-with-AI control beside the primary action
    And the control matches the sibling buttons' outline style and height
    And its coding-agent route carries that surface's own "<skill>" skill
    And its docs item links to the <surface> documentation overview

    Examples:
      | surface            | skill              |
      | traces             | tracing            |
      | experiments        | experiments        |
      | online evaluations | online-evaluations |
      | evaluators         | online-evaluations |
      | simulations        | scenarios          |
      | simulation runs    | scenarios          |
      | prompts            | prompts            |
      | datasets           | datasets           |

  @integration
  Scenario: The coding-agent prompt is offered first
    Given I can ask Langy on this project
    When I open the set-up-with-AI menu
    Then the first item copies the prompt for my own coding agent
    And the second item hands the surface's setup prompt to Langy

  @integration
  Scenario: The copied prompt carries the skill's own instructions
    When I choose the copy-a-prompt item
    Then the copied text holds the whole skill, not a line telling the agent to fetch it

  @integration
  Scenario: The copied prompt leads with the project's keys
    Given the surface minted an access token for me
    When I choose the copy-a-prompt item
    Then the copied text opens with the API key and project id
    And the skill follows under them
    And the token stays in the browser, because a request URL is logged

  @integration
  Scenario: The install line stands in until the skill arrives
    When I choose the copy-a-prompt item before the skill has loaded
    Then the copied text tells the agent to install the skill from the docs skills directory

  @integration
  Scenario: Langy stays out of the menu where the reader cannot ask
    Given I cannot ask Langy on this project
    When I open the set-up-with-AI menu
    Then no Langy item renders
    And the copy-prompt and docs items still do

  @integration
  Scenario Outline: Repo-connected surfaces ask Langy to connect the repository
    The surfaces whose setup lands as code changes tell Langy to connect to
    the repository and open a pull request; purely in-platform surfaces do not.

    When I hand the <surface> setup to Langy
    Then the prompt <asks> to connect the repository

    Examples:
      | surface            | asks     |
      | traces             | asks     |
      | experiments        | asks     |
      | simulations        | asks     |
      | online evaluations | does not |
      | prompts            | does not |
      | datasets           | does not |

  @integration
  Scenario: Copying the prompt confirms and survives a denied clipboard
    When I choose the copy-a-prompt item
    Then a toast confirms the copy on success
    And a toast reports the failure when the clipboard is unavailable
