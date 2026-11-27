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
    And a criterion past 4,000 characters is cut to its first 4,000 in its question

  @unit
  Scenario: A sure decision answer settles its criterion without an LLM call
    Given every criterion's decision answer is at or above the route's threshold
    When the verdict is judged
    Then a probability of one half or more is met and below it is unmet
    And a criterion with no probability is inconclusive
    And no LLM call is sent

  @unit
  Scenario: Unsure criteria share one send of the judge's own verdict call
    Given two of three criteria get an unsure decision answer
    When the verdict is judged
    Then one LLM call is sent with the judge's own messages and the finish_test tool forced
    And both criteria are read from that call by their keys
    And an entry that is not true, false or inconclusive is left out, and a call with no criteria object reads none
    And the call's tokens are billed once

  @unit @regression
  Scenario: The shared verdict call is read in the scenario SDK's per-criterion shape
    Given the finish_test tool as the scenario SDK 1.8.1 builds it
    When the LLM answers each criterion with its requirement, reasoning and a passed, failed or inconclusive status
    Then a passed criterion is met, a failed one unmet and an inconclusive one inconclusive
    And a bare status, or the older true, false or inconclusive string or boolean, is still read

  @unit @regression
  Scenario: The verdict carries the shared call's reasoning only when that call settled every criterion
    Given an unsure criterion read from the judge's own verdict call
    When a sure decision answer settles another criterion of the same verdict
    Then the verdict carries no reasoning, so the report explains it from the criteria results
    And when the shared call settled every criterion its reasoning is carried

  @unit
  Scenario: Criteria past the parallel cap share the same send and keep their order
    Given nine criteria that all get an unsure decision answer
    When the verdict is judged
    Then at most eight criteria are routed at once
    And one LLM call is sent for all nine
    And the criteria come back in the order they were asked

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
  Scenario: A failed decision backend hands the turn decision to its enabled fallback
    Given the decision backend fails and lists a switched-off LLM, a decision model and an LLM as fallbacks
    When a decision call is judged
    Then only the enabled LLM fallback is asked next
    And the decision is the tool it called
    And both calls are billed

  @unit
  Scenario: A table that names no decision backend answers no turn decision
    Given the public route table
    When a decision call is judged
    Then the answer is unavailable and nothing is sent

  @unit
  Scenario: Only a table with a turn decision backend can answer a scenario judge
    Given the public route table, or a table whose decision backend is switched off with no fallback
    When the judge is asked whether it can answer a scenario judge
    Then it says no, so a run on LangWatch Judge (preview) is refused before it starts
    And a table that names an enabled decision backend says yes

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
    And with no tool forced the model must call one of the offered tools
    And a call to a tool that was not offered, or arguments that are not JSON, is read as no call with its tokens still billed
    And a call sent with empty arguments is read as a call with no arguments
    And a wire this install holds no key for is skipped as not configured, sending nothing

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

  @unit
  Scenario: A gated route sends an easy criterion to the primary and a hard one to the shared call
    Given a scenario route whose entry has a gate, a decision primary and an LLM escalation
    And the gate rates one criterion under the threshold and two at or above it
    When the verdict call is judged
    Then the easy criterion is one decision request and is answered by it
    And the two hard criteria share one send of the judge's own verdict call
    And the gate's sends, the decision request and the shared call are billed in the one fact

  @unit @regression
  Scenario: The gate reads a criterion as the raw criterion the benchmark measured
    Given a gated scenario route
    When a criterion is routed
    Then the gate's task line is the criterion's own text, as the gate's cut was measured on
    And never the decision question's judging sentence around it

  @unit
  Scenario: The shared verdict call carries the backend's reasoning effort
    Given an escalation backend that sets a reasoning effort
    When a criterion reaches it
    Then the judge's own verdict call names that effort
    And a backend that sets none sends a call that names none

  @unit @regression
  Scenario: The judge's own calls carry the backend's output cap
    Given an LLM backend whose table entry sets its own output cap
    When the judge's own verdict call or its turn decision call is sent on it
    Then the request carries that cap, not the wire's default
    And a call stopped at that cap is skipped, billed and logged with its stop reason

  @unit
  Scenario: A Gemini backend answers the judge's own call as a forced function call
    Given a backend of kind gemini_generate_content naming its model
    When the judge's own call is sent on it
    Then the request goes to that model's generateContent path with the key in a header, never the URL
    And the system text, the one user turn and the tools are sent with the tool's call required
    And JSON-schema keys the API refuses are left out of the tool parameters
    And the function call's arguments are read back, with thinking tokens billed as output

  @unit
  Scenario: A Gemini backend answers a routed question of any kind
    Given a routed yes or no, score or category question that reaches a Gemini backend
    When the leg answers by calling the evaluation function
    Then the answer is read as on the other LLM wires

  @unit
  Scenario: A route table holds a Gemini backend to a bare model id and no reasoning effort
    Given a gemini_generate_content backend with no model, a model that is not a bare id, or a reasoning effort
    When the table is parsed
    Then it is refused naming the backend

  @unit
  Scenario: Boot refuses a Gemini backend when the install holds no Gemini key
    Given a configured table that reaches a gemini_generate_content backend
    And the install holds no Gemini key
    When the judge boots
    Then it refuses, naming the backend and its kind

  @unit
  Scenario: A Gemini call on an install with no Gemini key is skipped and sends nothing
    Given an install that holds no Gemini key
    When a call is sent on the gemini_generate_content wire
    Then it is skipped as not configured and no request leaves the install
