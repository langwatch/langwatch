Feature: Every policy is a plain check that refuses to read clean without its anchors
  As an author reading an architecture-enforcer run
  I want every finding reported and every missing input named
  So that a clean run means the tree is clean, not that a file exempted it or went missing

  @unit @architecture
  Scenario: No policy reads a baseline
    Given the policy registry
    When a policy checks the workspace
    Then it reports every finding it makes
    And no registry entry names a baseline file, and the package ships none

  @unit @architecture
  Scenario: A policy whose anchor file is gone refuses the run by name
    Given a policy that reads a fixed file of the workspace, such as the generated server module list or a process entrypoint
    When that file does not exist
    Then the policy throws, naming itself and the missing file
    And it never reports the empty result a missing file would otherwise produce

  @unit @architecture
  Scenario: A missing anchor fails the run by name
    Given the architecture-enforcer CLI runs a policy whose anchor is missing
    When the run ends
    Then it exits with the crash code and the message names the policy and the file

  @unit @architecture
  Scenario: The CI gate names only registered policies
    Given the CI job runs the enforcer over an explicit list of policies held at zero findings
    When the list is read
    Then every id on it is a registered policy, so a renamed or retired policy cannot silently drop out of the gate
