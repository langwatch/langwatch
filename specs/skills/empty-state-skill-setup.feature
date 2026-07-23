Feature: Set up with AI from every empty page
  The set-up-with-AI control lives where the gap actually is: each feature
  page's empty state, not the home. Every surface offers the same three
  routes, fed by that surface's own docs skill: hand the job to Langy (who
  has the skills loaded), copy a prompt that installs the skill into the
  reader's own coding agent, or read that feature's docs.

  Background:
    Given a project with no data on the surface being visited

  Scenario: The home no longer carries the setup control
    When I open the Langy home
    Then no onboarding pill renders in the hero
    And no ask chips row renders under the field
    # The getting-started asks moved into the command bar (under the Ask Langy
    # CTA), so the hero itself carries only the field.

  Scenario Outline: Every empty surface offers its own skill
    When I open the <surface> page with no <surface> yet
    Then the empty state shows a set-up-with-AI control beside the primary action
    And the control matches the sibling buttons' outline style and height
    And its coding-agent prompt installs the "<skill>" skill from the docs skills directory
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

  Scenario: Langy is offered first where the reader can ask
    Given I can ask Langy on this project
    When I open the set-up-with-AI menu
    Then the first item hands the surface's setup prompt to Langy

  Scenario: Langy stays out of the menu where the reader cannot ask
    Given I cannot ask Langy on this project
    When I open the set-up-with-AI menu
    Then no Langy item renders
    And the copy-prompt and docs items still do

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

  Scenario: Copying the prompt confirms and survives a denied clipboard
    When I choose the copy-a-prompt item
    Then a toast confirms the copy on success
    And a toast reports the failure when the clipboard is unavailable
