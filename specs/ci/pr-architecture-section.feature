Feature: Pull requests never make an architecture decision no check makes
  As the platform
  I want every change that no lint rule or enforcer policy decides to carry
  the decision a human made, and the rule that now encodes it
  So that an agent asks instead of deciding and ticking, and the next change
  like it is decided by a check rather than by a person noticing

  A code PR carries a "## Architecture" section with two parts. "Decisions no
  check makes" records, for every change the diff makes that no rule decides,
  the options the agent showed its human, the human's choice, and the rule this
  PR adds to encode it. "Needs a human look" is free-form notes for reviewers.
  There is no conformance checkbox: a box the author ticks proves nothing.

  The changes no check decides are read from the diff, not from the
  description: a new line in dev/docs/ARCHITECTURE.md, an added lint
  suppression, a new workspace package, a new module in the catalogue, a lint
  rule switched off or deleted, an enforcer policy dropped from the CI gate, an
  entry added to a rule's exemption list, a shrink-only count raised, a test
  budget loosened, and a change to what runs the ratchet and rule tests. A
  lint config and the CI gate are also compared as parsed contents before and
  after, because a rule can be loosened without a single key disappearing.

  Each such change has a subject: the rule id, policy id, ignore pattern, gate
  step or file it touches. Some recorded decision has to name every subject, so
  one decision cannot stand in for all of them.

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
  Scenario: A missing or empty human-look part fails
    Given the PR description has the "## Architecture" section
    And there is no "Needs a human look" heading, or nothing under it but comments
    Then the check fails and tells the author to list what is unusual or write "None"

  @unit
  Scenario: No conformance checkbox is asked for
    Given the PR description has the "## Architecture" section with no checkbox in it
    And both of its parts are filled in
    Then the check passes

  @unit
  Scenario: A change no check decides is found in the diff
    Given the diff adds a line to dev/docs/ARCHITECTURE.md, or a lint suppression outside the rules' own source
    Or the diff adds a workspace package, or a module root to the module catalogue
    Or the diff switches a lint rule off, deletes a rule or policy, or drops a policy from the CI gate
    Then the check names that change, its file and what it found

  @unit
  Scenario: Loosening a check is a change no check decides
    Given the diff adds an entry to an exemption list inside a lint rule or enforcer policy
    Or the diff adds a key to, or raises a count in, a shrink-only baseline list
    Or the diff raises a number in a test's budget, cap, limit or timeout
    Then the check names that change, its file and what it found
    And a new shrink-only list or a lowered count is not a loosening

  @unit
  Scenario: A change no check decides fails until a human's decision is recorded
    Given the diff makes a change no check decides
    And "Decisions no check makes" is missing, empty or "None"
    Then the check fails, naming each such change
    And it tells the agent to stop and ask its human, showing options and the architecture patterns for each, and to add the rule that encodes the answer

  @unit
  Scenario: A recorded decision names the options, the human's choice and the rule
    Given a decision under "Decisions no check makes" lacks its options, the human's choice or its rule
    Then the check fails and says which part is missing
    And a rule it names must be a lint rule, enforcer policy, lint config or the CI gate this PR changes, or "none" with the reason

  @unit
  Scenario: A recorded decision with its rule passes
    Given the diff makes a change no check decides
    And "Decisions no check makes" records the options, the human's choice and a rule file this PR changes
    Then the check passes

  @unit
  Scenario: A change every check decides needs only None
    Given the diff makes no change that no check decides
    And "Decisions no check makes" says "None"
    Then the check passes

  @unit
  Scenario: Loosening a lint config without removing a rule is a change no check decides
    Given the diff changes an oxlint config, read as parsed contents before and after
    When it lowers a rule's severity, adds or widens an override that lowers or switches off a rule, adds an ignore pattern or an override exclusion, or raises a rule's numeric option
    Then the check names each loosened rule or pattern as its subject
    And raising a severity, adding a rule at error, or lowering a limit is not a loosening
    And a config it cannot read or parse on both sides is treated as loosened

  @unit
  Scenario: Removing a ratchet or weakening the gate is a change no check decides
    Given the diff deletes or renames a ratchet test or baseline under the architecture enforcer's tests
    Or the diff renames a baseline and raises its counts
    Or the diff gives the "Architecture lint (blocking)", "Architecture policy tests (blocking)" or "Oxlint rule tests (blocking)" step or its job a new "if:" or "continue-on-error", changes its command, or removes it
    Or the diff changes the "test" script of the architecture enforcer or the oxlint rules package, or adds, changes or removes a vitest config in either
    Or the diff deletes a lint rule's or enforcer policy's source
    Then the check names that change with its file, policy or step as the subject
    And adding a policy to the gate's list is not a weakening

  @unit
  Scenario: Every change no check decides is named by a recorded decision
    Given the diff makes several changes no check decides
    And the recorded decisions name only some of their subjects
    Then the check fails, listing each change whose subject no decision names
    And one decision may name several subjects

  @unit
  Scenario: A decision's rule is neither a baseline nor the config the change loosens
    Given a recorded decision names a baseline file as its rule
    Or it names, as its rule, the lint config or gate whose loosening it records
    Then the check fails and asks for the rule that encodes the answer, or "none" with the reason
