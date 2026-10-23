Feature: Routing an Instant Evals judgement across decision models and LLMs

  As the platform
  I want a judge call that carries a route to be answered by the model its slot names
  So that cheap decision models answer what they are sure of and an LLM answers the rest

  The router is a synchronous step inside the judge leaf (ROUTER-PLACEMENT option a). A call with
  no route takes today's single hosted classifier call. The public route table sends every slot
  to the hosted classifier; the real table and prices are deploy-time configuration.

  @unit
  Scenario: A call with no route keeps today's single classifier call
    Given a judge call with no route
    When it is judged
    Then the hosted classifier is called once, exactly as before the router
    And the judgement carries no routing and no routed cost

  @unit
  Scenario: The public default table sends every slot to the hosted classifier
    Given the route table the repository ships
    When any job, length and mode is routed
    Then the plan asks the hosted classifier alone, with no escalation and no pair

  @unit
  Scenario: The route table refuses a slot without an instant entry
    Given a route table whose slot names no instant entry, or an escalation without a threshold
    When the deployment boots
    Then the configuration is refused, naming the slot

  @unit
  Scenario: A slot is picked by job, length bucket and arithmetic flag
    Given a route table with length buckets and an arithmetic slot
    When a call is routed
    Then its slot is the arithmetic slot for a short arithmetic question, else its length bucket

  @unit
  Scenario: A mode with no usable entry falls back to the next cheaper mode
    Given a slot with no accurate entry, or one whose backend is switched off
    When an accurate call is routed
    Then the balanced entry answers, and instant when balanced is missing too

  @unit
  Scenario: The input view follows the question category from config
    Given a route table mapping the sentiment category to the text view
    When a sentiment call with no view of its own is routed
    Then the plan judges the conversation text only
    And a call naming its own view keeps it

  @unit
  Scenario: The length bucket is measured on the chosen view
    Given a long trace whose conversation text is short
    When a text-view call is routed
    Then its bucket comes from the conversation text's tokens

  @unit
  Scenario: A text view the caller did not render judges the full text, flagged
    Given a plan for the text view and a call that carries no conversation rendering
    When it is judged
    Then the full text is judged and the routing names the missing view

  @unit
  Scenario: A sure decision-model answer stays
    Given a plan that escalates unsure answers to an LLM
    When the decision model answers with a probability far from one half
    Then its verdict is kept and the LLM is not called

  @unit
  Scenario: An unsure decision-model answer escalates to the LLM leg
    Given a plan that escalates when the absolute value of 2p - 1 is below the threshold
    When the decision model answers inside that band
    Then the LLM answers, the judgement counts one escalation and the cost sums both calls

  @unit
  Scenario: The confident pair keeps the more confident answer
    Given a plan that pairs two decision models in parallel
    When both answer
    Then the verdict further from one half is kept, the primary on a tie, and both calls are paid

  @unit
  Scenario: A backend that is down falls back to its configured fallback
    Given a primary whose backend is unavailable and a fallback configured for it
    When the call is judged
    Then the fallback answers and the routing names the fallback taken

  @unit
  Scenario: An LLM leg that fails keeps the primary verdict, flagged
    Given an unsure primary answer and an escalation that times out
    When the call is judged
    Then the primary verdict is kept and the routing names the failed escalation

  @unit
  Scenario: Nothing answered gives the last backend's skip reason
    Given every backend of the plan fails
    When the call is judged
    Then the judgement is skipped with the platform's skip reason, never a provider's text

  @unit
  Scenario: The LLM legs send one forced yes-or-no tool call and read it back
    Given an Anthropic Messages backend and an OpenAI Responses backend
    When each is asked one yes-or-no question
    Then each request forces the evaluation tool, and the answer is read from its result
    And a refused key, a rate limit and an outage map to the platform's skip reasons

  @unit
  Scenario: A routed judgement is priced from the summed cost of every call
    Given a routed judge call whose legs cost a known amount
    When it is priced
    Then the priced fact carries that cost times the markup, under the router's model and rate

  @unit
  Scenario: A page event without a routed cost still reads and prices from tokens
    Given a page_judged event written before the router
    When it is read
    Then its routed cost reads as zero and its spend is priced from its input tokens

  @unit
  Scenario: The router flag is off by default
    Given the feature flag registry
    When the router flag is read with no targeting rule
    Then it is off, so no caller sends a route
