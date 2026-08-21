Feature: Langy can run a conversation on the pi harness
  Langy's worker runs on one of two coding-agent harnesses, selected per
  project. The harness rides the same credential envelope as every other
  worker-shaping input, so a change replaces the worker instead of quietly
  reusing one built for the other harness, and a deploy that introduces
  harness selection does not touch any worker that was running before it.

  # Companion specs:
  #   - specs/langy/langy-minimal-harness.feature  (what the worker's prompt and
  #     tool surface look like, harness-independent)
  #   - specs/langy/langy-stop-and-resume.feature  (the user-facing stop this
  #     feature's cancel path completes)

  @unit
  Scenario: A conversation that names no harness keeps its running worker
    Given a worker is running for a conversation that never named a harness
    When the next turn arrives naming the default harness explicitly
    Then the running worker is reused
    And no worker is replaced just because harness selection was deployed

  @unit
  Scenario: Selecting the pi harness replaces the conversation's worker
    Given a worker is running for a conversation on the default harness
    When the next turn arrives selecting the pi harness
    Then the running worker does not match and is replaced
    And the conversation continues on a worker built for the pi harness

  @unit
  Scenario: An unrecognized harness value falls back to the default harness
    Given a turn arrives naming a harness this manager does not know
    When the manager resolves the harness
    Then the turn runs on the default harness
    And the unknown value never selects an unfinished or absent harness

  @unit
  Scenario: The pre-turn probe answers for the harness the turn will use
    Given the control plane asks whether a matching worker is already running
    When the probe names the harness the turn would run on
    Then the answer compares the running worker's harness too
    And a harness change is a miss, so the turn replaces the worker instead of reusing it

  @unit
  Scenario: A cancel reaches the worker running the named turn
    Given a worker is running a turn the user asked to stop
    When the manager receives the cancel for that conversation and turn
    Then the worker is told to abort exactly that turn
    And the generation stops burning tokens

  @unit
  Scenario: A cancel naming a turn that is not running changes nothing
    Given a worker is running a turn
    When a cancel arrives naming a different turn, or a conversation with no worker
    Then nothing is aborted
    And the running turn continues untouched
