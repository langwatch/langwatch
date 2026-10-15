Feature: Pull requests state that they follow the architecture
  As a reviewer
  I want every code PR's description to say the author read the architecture
  guide and to flag anything unusual
  So that I know where to look first, and a change that bends a rule never
  arrives unannounced

  A code PR carries a "## Architecture" section: a ticked box saying the
  author read the sections of dev/docs/ARCHITECTURE.md the change touches and
  that it follows them, and a "Needs a human look" part. Anything unusual,
  outside the usual patterns or questionable goes there; "None" is an accepted
  answer, an empty part is not.

  Background:
    Given a pull request whose head repo matches the target repo
    And the branch is not a release-please branch

  @unit
  Scenario: A PR that changes code needs the Architecture section
    Given at least one changed file is neither documentation nor a dependency file
    Then the check requires the "## Architecture" section

  @unit
  Scenario: A PR that changes only documentation is exempt
    Given every changed file is under docs/ or is markdown outside the architecture record
    Then the check passes without requiring the section
    And a change to dev/docs, an ADR, a skill or CLAUDE.md still requires it

  @unit
  Scenario: A dependency bot's dependency bump is exempt
    Given the PR is authored by a trusted dependency-update bot
    And every changed file is a lockfile or a dependency manifest
    Then the check passes without requiring the section
    And a human's manifest edit still requires it

  @unit
  Scenario: A description with no Architecture heading fails
    Given the PR description has no "## Architecture" heading
    Then the check fails and tells the author to add the section

  @unit
  Scenario: An unticked conformance box fails
    Given the PR description has the "## Architecture" section
    And its conformance checkbox is not ticked
    Then the check fails and tells the author to read the sections and tick it

  @unit
  Scenario: A missing or empty human-look part fails
    Given the PR description has the "## Architecture" section with its box ticked
    And there is no "Needs a human look" heading, or nothing under it but comments
    Then the check fails and tells the author to list what is unusual or write "None"

  @unit
  Scenario: A filled-in section passes, and None counts as filled in
    Given the PR description has the "## Architecture" section with its box ticked
    And "Needs a human look" holds text, or the word "None"
    Then the check passes
