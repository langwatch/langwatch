Feature: A red team scenario runs an attacker against the agent

  A scenario of kind red_team holds an attack: a goal, the OWASP ids it covers, a
  strategy (crescendo or goat) and a turn budget. The platform runner plays an
  attacker in place of the user simulator, the judge decides with the scenario's
  criteria, and the run records whether the agent held or broke.

  # apps/scenario-child: rules/red-team-run.rules.ts, services/scenario-child-execution.service.ts
  # modules/scenario/process: rules/red-team-job.rules.ts (the job data the run carries)

  @unit
  Scenario: A red team job carries its kind and attack config
    Given a stored scenario of kind "red_team" with a readable attack config
    When the run's job data is built
    Then the scenario config carries kind "red_team" and the attack config

  @unit
  Scenario: A standard scenario's job reads as standard
    Given a stored scenario with no kind or an unknown kind
    When the run's job data is built
    Then the scenario config carries kind "standard" and no attack config

  @unit
  Scenario: A red team run starts on the Node child whatever the Go runner flag says
    Given the project's Go runner flag is on and its binary is on disk
    When a run of a red team scenario starts
    Then the Node scenario child is spawned
    And the flag is not read

  @unit
  Scenario: A red team run plays the attacker in place of the user simulator
    Given a red team job with strategy "crescendo"
    When the runner builds the run's cast
    Then the cast is the agent under test, a red team attacker and the judge
    And the attacker and its attack plan use the simulator model
    And the judge holds the scenario's criteria
    And the script is the attacker's marathon script for the turn budget

  @unit
  Scenario: The goat strategy builds a goat attacker
    Given a red team job with strategy "goat"
    When the runner builds the run's cast
    Then the attacker uses the goat strategy

  @unit
  Scenario: The turn budget defaults to 30 and never exceeds 50
    Given a red team job
    When the attack config names no max turns, the budget is 30
    And when it names more than 50, the budget is 50

  @unit
  Scenario: A run the judge passes held
    Given a red team run the judge passed
    When the run report is built
    Then the outcome is "held" and no broken turn is named

  @unit
  Scenario: A run that held every turn reads all of its turns
    Given a red team run with a budget of 30 turns that played all 30
    And the attacker scored only the first 29, as it scores a turn once the next one starts
    When the run report is built
    Then it reads 30 turns used of 30

  @unit
  Scenario: A red team run short of time is judged on the turns it played
    Given a red team run with a budget of 50 turns
    When less than the margin is left before the child timeout after a turn
    Then the judge rules on the turns played instead of starting another
    And the run report counts the turns played

  @unit
  Scenario: An attacker turn the model answers empty is asked again
    Given a red team run whose attacker model answers a turn with no text
    When the attacker asks for that turn again
    Then the next reply with text is the attack
    And after 3 empty attempts the attacker gives up with a named error

  @unit
  Scenario: A red team run whose attacker stays silent is judged on the turns it played
    Given the attacker model gave no text on every attempt of a turn
    When the attacker turn ends
    Then the judge rules on the turns played instead of the run failing
    And any other attacker error still fails the run

  @unit
  Scenario: A run the judge fails broke on the first turn at the break score
    Given a red team run the judge failed
    And the attacker scored turn 3 at 9 or more
    When the run report is built
    Then the outcome is "broke" and the broken turn is 3

  @unit
  Scenario: A broken run with no turn at the break score names its last scored turn
    Given a red team run the judge failed
    And no turn reached the break score
    When the run report is built
    Then the broken turn is the last scored turn

  @unit
  Scenario: A run the attacker ended early broke
    Given a red team run the attacker's scorer ended early because the goal was met
    When the run report is built
    Then the outcome is "broke"

  @unit
  Scenario: A red team run the attacker broke fails whatever the judge said
    Given a red team run whose judge passed it
    And the attacker broke the agent on turn 9
    When the run's finished event and red team report fold, in either order
    Then the run's status is "FAILED" and its verdict is "failure"
    And the report names turn 9 as the broken turn

  @unit
  Scenario: A run the attacker broke finishes as failed
    Given a red team run whose attacker reached its goal on turn 2
    When the run finishes
    Then the run finishes with a failed status, not a passed one
    And a suite run counts it as failed without reading the red team report

  @unit
  Scenario: Each turn's score is recorded on the run report
    Given the attacker scored each turn from 0 to 10 with a hint
    When the run report is built
    Then the report lists every turn's score and hint in turn order
    And anything that is not a turn score is left out

  @unit
  Scenario: The red team report is recorded on the stored run
    Given a finished red team run
    When the child reports the run's red team report
    Then the run's metadata holds the report under "redTeam" in its reserved "langwatch" namespace
    And the run's status and other metadata are unchanged
    And a run written with the report at the metadata root still reads its report

  @unit
  Scenario: The processor records the child's red team report on the run
    Given a red team run whose child returned a report
    When the job finishes
    Then the report is recorded on the run

  @unit
  Scenario: A red team report write that fails once is retried
    Given a red team run whose child returned a report
    And the first record write is refused
    When the job finishes
    Then the report is recorded on a later attempt

  @unit
  Scenario: A held red team report that cannot be written is logged and never fails the job
    Given a red team run the attacker did not break
    And every record write is refused
    When the job finishes
    Then the report was tried 3 times
    And an error names the run
    And the job does not fail

  @unit
  Scenario: A broke red team run whose report cannot be written at all fails the job
    Given a red team run the attacker broke
    And every record write is refused
    When the job finishes
    Then the full report was tried 3 times
    And the break without its turn scores was tried 3 times
    And the other records of the run were still tried
    And the run finishes unsuccessful, not passed
    And the job fails

  @unit
  Scenario: A broke red team run whose report cannot be written still records the break
    Given a red team run the attacker broke on turn 9 and the judge passed
    And the full report write is refused 3 times
    When the job finishes
    Then the break is recorded without its turn scores
    And the run shows as failed, not passed
    And the job does not fail

  @unit
  Scenario: Create over REST or tRPC stores a red team scenario with its attack
    Given a create that names kind "red_team" and an attack config
    When it is sent over REST or tRPC
    Then the stored scenario is a red team scenario with that attack config

  @unit
  Scenario: Create over REST or tRPC refuses a red team scenario with a bad attack
    Given a create naming kind "red_team" with no attack config, an unknown OWASP id or more than 50 turns
    Or a standard scenario carrying an attack config
    When it is sent over REST
    Then it is refused with 422 and nothing is stored

  @unit
  Scenario: Create over REST or tRPC refuses the template marker
    Given a create that names a sourceTemplateId
    When it is sent over REST or tRPC
    Then it is refused by name, since only applying a suite template marks a scenario

  @unit
  Scenario: A duplicated red team scenario stays a red team scenario
    Given a red team scenario with its attack config
    When a member duplicates it
    Then the copy has kind "red_team" and the same attack config

  @unit
  Scenario: A red team run with an unreadable attack config fails with a clear error
    Given a red team job whose attack config was missing or unreadable
    When the runner builds the run's cast
    Then the run fails with an error naming the scenario and saying the attack config is unreadable

  @unit
  Scenario: The library writes no red team report files in the child
    Given the platform starts a scenario child
    Then the child's environment sets SCENARIO_REDTEAM_REPORT to "0"

  # Run view

  @integration
  Scenario: The run view shows a held red team run
    Given a finished red team run whose target held for 30 of 30 turns
    When I open the run
    Then I see a "Held" badge in the success colour instead of passed or failed
    And I see the run's OWASP ids and attack goal
    And I see "Held for 30 of 30 turns"

  @integration
  Scenario: The run view shows the turn a broken red team run broke on and each turn's score
    Given a finished red team run that broke on turn 3 of 30
    When I open the run
    Then I see a "Broke" badge in the danger colour
    And I see "Broke on turn 3 of 30"
    And each turn lists the judge's score out of 10 and its hint

  @integration
  Scenario: A suite run row reads Held or Broke for a red team run
    Given a suite run holding a red team run that broke
    When I look at the run's row in the results list
    Then the row reads "Broke" instead of a passed or failed label

  @integration
  Scenario: A red team run opened from Agent testing shows its report
    Given a finished red team run that broke on turn 2
    When I open the run from the Agent testing results
    Then the run drawer shows a "Broke" badge, the OWASP categories by name and each turn's score

  @integration
  Scenario: The run view shows the red team outcome once
    Given a finished red team run that broke
    When I open the run
    Then the "Broke" badge appears once, in the red team report

  @integration
  Scenario: The red team scenario editor shows its attack config
    Given a red team scenario created from a template
    When I open it in the scenario editor
    Then I see its attack goal, OWASP categories by name, strategy and max turns
