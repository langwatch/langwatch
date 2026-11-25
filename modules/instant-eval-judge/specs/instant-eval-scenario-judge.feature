Feature: A scenario judgement answered by the judge router

  As a team running scenarios on LangWatch Cloud
  I want the scenario judge's verdict answered by the routed judge
  So that a run is judged as accurately as a frontier model and faster

  A scenario judge asks two things: after each turn whether the conversation goes on, and at the
  end whether each criterion was met. The verdict is routed: every criterion is its own
  `scenario_judge` yes or no question on the route table, so each one escalates alone, and the
  criteria that reach an LLM leg share one send of the judge's own verdict call, read back by
  criterion key. The turn decision is not routed: it is the judge's own call on the backend the
  table names in `scenarioDecision`. One judgement is one priced fact under the model
  langwatch-judge-preview, priced from the summed cost of its calls at the one markup (ADR-190).
  The route table decides which backends answer; nothing here names one.

  @unit
  Scenario: Each criterion is routed as its own yes or no question
    Given a verdict call with three criteria
    When it is judged
    Then the decision model gets three requests, each with one question about one criterion
    And each request carries the scenario's description and the judge's content

  @unit
  Scenario: A criterion's question keeps the measured wording
    Given a criterion "The agent offers a refund"
    When its question is built
    Then its instructions name the criterion after the fixed judging sentence
    And its two sides say the conversation shows it was met, or does not

  @unit
  Scenario: A sure decision answer settles its criterion without an LLM call
    Given every criterion's decision answer is at or above the route's threshold
    When the verdict is judged
    Then a probability of one half or more is met and below it is unmet
    And no LLM call is sent

  @unit
  Scenario: Unsure criteria share one send of the judge's own verdict call
    Given two of three criteria get an unsure decision answer
    When the verdict is judged
    Then one LLM call is sent with the judge's own messages and the finish_test tool forced
    And both criteria are read from that call by their keys
    And the call's tokens are billed once

  @unit
  Scenario: An LLM's inconclusive answer stays inconclusive
    Given an unsure criterion that the judge's verdict call marks inconclusive
    When the verdict is judged
    Then the criterion is inconclusive, neither met nor unmet

  @unit
  Scenario: A criterion no leg answered is inconclusive, never a guess
    Given one criterion whose every leg failed while another was answered
    When the verdict is judged
    Then the unanswered criterion is inconclusive
    And the answered criterion keeps its result

  @unit
  Scenario: A verdict nothing answered is unavailable
    Given every leg fails for every criterion
    When the verdict is judged
    Then the answer is unavailable and carries no criteria

  @unit
  Scenario: A failed primary sends its criterion to the escalation
    Given the decision model is down
    When the verdict is judged
    Then every criterion is read from the shared verdict call

  @unit
  Scenario: The threshold is compared on the router's sureness scale
    Given a route that keeps a decision answer at sureness 0.98
    When a criterion is answered with probability 0.99, 0.01 and 0.989
    Then 0.99 and 0.01 keep the decision answer
    And 0.989 goes to the LLM leg

  @unit
  Scenario: The length bucket picks the criterion's route
    Given a table whose short bucket ends at 7,999 tokens
    When a judged text of 7,999 tokens and one of 8,000 tokens are planned
    Then the first takes the short slot and the second the long slot

  @unit
  Scenario: The turn decision is the judge's own call on the table's decision backend
    Given a table that names a scenario decision backend
    When a decision call is judged
    Then that backend gets the judge's messages with the continue_test and make_verdict tools
    And the tool it called is the decision

  @unit
  Scenario: A turn decision that fails lets the conversation go on
    Given the decision backend fails or answers unreadably
    When a decision call is judged
    Then the decision is continue

  @unit
  Scenario: A table that names no decision backend answers no turn decision
    Given the public route table
    When a decision call is judged
    Then the answer is unavailable and nothing is sent

  @unit
  Scenario: A judgement is one priced fact under the judge preview model
    Given a verdict whose decision requests and shared LLM call were paid
    When it is recorded
    Then one fact is appended under the model langwatch-judge-preview
    And its cost is the sum of every call and its price that cost times the markup
    And its request count is the number of criteria

  @unit
  Scenario: A scenario judgement off LangWatch Cloud is refused and sends nothing
    Given an installation that is not LangWatch Cloud
    When a verdict call is judged
    Then it is refused as not configured and no backend is called

  @unit
  Scenario: A project the judge has not learned is refused
    Given a project the judge has no placement for
    When a verdict call is judged
    Then it is refused as unknown and no backend is called

  @unit
  Scenario: A spent free budget refuses the scenario judgement
    Given an organization without usage billing that has spent its free budget
    When a verdict call is judged
    Then it is refused as budget exhausted and no backend is called

  @unit
  Scenario: A caller's stop after paid legs still records what they spent
    Given a verdict whose decision requests were paid before the caller stopped
    When the stop is rethrown
    Then the paid legs are recorded under a freshly minted request id

  @unit
  Scenario: The judge's own call is sent on the leg's wire with its tool forced
    Given an LLM leg on each wire
    When the judge's verdict call is sent
    Then the body carries the judge's system and user messages and only the forced tool
    And the called tool's arguments and the billed tokens are read back

  @unit
  Scenario: A provider failure of the judge's own call is a failed leg, never a retry
    Given the provider answers 429 or 500
    When the judge's own call is sent
    Then it is skipped with the platform's reason after one send

  @unit
  Scenario: A route table names its scenario decision backend
    Given a route table with a scenarioDecision key
    When the table is parsed
    Then an LLM backend is accepted
    And an unknown backend or a decision model is refused

  @unit
  Scenario: Boot refuses a decision backend it cannot bill or call
    Given a configured table whose scenario decision backend has no price or no key
    When the judge boots
    Then it refuses with an issue naming that backend
