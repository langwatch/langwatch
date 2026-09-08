Feature: One lint run is readable to the agent that has to act on it
  As an agent driving a change through the architecture gate
  I want the run to say what refused me before it says where
  So that I read a verdict, not a transcript

  Background:
    Given architecture lint prints its report to stderr and its clean verdict to stdout
    And the report carries no colour codes, because the reader is usually an agent

  @unit @architecture
  Scenario: A failing run leads with its summary
    Given several policies refuse something in the workspace
    When architecture lint checks the workspace
    Then the first line names the total findings, the policy count and the exit code
    And a count line for every policy that refused something follows it
    And the findings themselves come after the summary, grouped under the policy that refused them
    And each finding is one line-pair: the policy and location, then the message and the way out

  @unit @architecture
  Scenario: The summary is the first thing a real run prints
    Given a policy refuses more findings than the cap allows in a real workspace
    When architecture lint is run as a command
    Then the whole summary is inside the first forty lines of the run
    And the capped findings follow it
    And the all-findings flag prints the ones the cap hid

  @unit @architecture
  Scenario: A noisy policy is capped so the quiet ones stay visible
    Given one policy reports more findings than the per-policy cap
    When architecture lint checks the workspace
    Then only the first findings of that policy are printed
    And a line says how many further findings the cap hid
    And every other policy is still printed in full

  @unit @architecture
  Scenario: The whole list is available on request
    Given one policy reports more findings than the per-policy cap
    When architecture lint checks the workspace with the all-findings flag
    Then every finding of that policy is printed
    And the summary no longer offers the flag

  @unit @architecture
  Scenario: The comment-block review attention list is asked for, never volunteered
    Given source files carry comment blocks long enough to deserve a second look
    When architecture lint checks the workspace
    Then the review attention list is not printed
    When architecture lint is asked for the comment-block review
    Then the list is printed
    And the exit code is the clean one, because a review is not a refusal

  @unit @architecture
  Scenario: The exit code separates a clean tree, a refusal and a misuse
    Given a workspace no policy refuses
    When architecture lint checks the workspace
    Then it exits clean and says the package boundaries are sealed
    When a policy refuses something
    Then it exits with the failure code
    When the run is given an argument it does not know
    Then it exits with the usage code and prints the usage text

  @unit @architecture
  Scenario: Stale baseline rows are counted in the summary
    Given a policy reports a baseline row that no longer earns its keep
    When architecture lint checks the workspace
    Then the summary counts the stale rows beside the findings
    And the exit code is the failure one, because a stale allowance is a refusal
