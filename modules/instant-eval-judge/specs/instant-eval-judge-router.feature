Feature: Routing an Instant Evals judgement across decision models and LLMs

  As the platform
  I want a judge call that carries a route to be answered by the model its slot names
  So that cheap decision models answer what they are sure of and an LLM answers the rest

  Yes-or-no questions are always routed; score and category questions only when the table routes
  their kind (each kind reads an answer's sureness its own way), else they take today's call.

  The router is a synchronous step inside the judge leaf, priced as ADR-190 records
  (dev/docs/adr/190-instant-evals-routed-judgement-is-priced-from-summed-call-cost.md). A call with
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
  Scenario: A decision-model backend names its model in the table
    Given a route table with a Decisions backend that names no model
    When the deployment boots
    Then the configuration is refused, naming the backend, since the code holds no default model

  @unit
  Scenario: A route table that cannot bill or call a backend refuses to boot
    Given a configured route table
    When a backend a slot or an enabled fallback can reach has no price, key or channel
    Then the deployment refuses to boot, naming each such backend
    And bucket bounds must rise with unique names and only the last bucket open
    And no backend may list itself as a fallback
    And an escalation's fallbacks never ask the primary again

  @unit
  Scenario: A routed call needs the hosted classifier key only when its table reaches it
    Given a deployment with no hosted classifier key, whose route table never reaches it
    When a routed call is judged
    Then the router answers it from the backends it can reach
    And a call with no route is still refused as not configured

  @unit
  Scenario: A pair names decision models only
    Given a route table pairing an LLM backend, or a pair member whose fallback is an LLM
    When the deployment boots
    Then the configuration is refused, since an LLM's yes or no would always win the pair

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
    Given a route table mapping the sentiment category, a wording question, to the text view
    When a sentiment call with no view of its own is routed
    Then the plan judges the conversation text only
    And a call naming its own view keeps it

  @unit
  Scenario: The text view is judged only by a decision model allowed to read it
    Given a route table that lets only the Decisions API judge the conversation text
    And lets no backend judge the tools view unless the table allows its kind
    When a question maps to a partial view but its slot plans a model not allowed to read it
    Then the plan judges the full trace instead and the routing names the refused view
    And an escalation always judges the full trace, since an outcome may turn on a tool result
    And a fallback whose kind may not read the view judges the full trace, flagged

  @unit
  Scenario: The tools view is used only when it is shorter than the full trace
    Given a question category the table maps to the tools view, on a backend allowed to read it
    When the rendered tools view has at least as many tokens as the full trace
    Then the plan judges the full trace and the routing names the view as not shorter
    And the mapping from category to view is configuration only, with the full trace as default

  @unit
  Scenario: The length bucket is measured on the chosen view
    Given a long trace whose conversation text is short
    When a text-view call is routed
    Then its bucket comes from the conversation text's tokens

  @unit
  Scenario: A text view the caller did not render judges the full text, flagged
    Given a plan for the text view and a call whose conversation rendering is absent or empty
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
    And for a score or category the surer answer by its kind's sureness rule is kept

  @unit
  Scenario: A kind the table does not route takes today's classifier call
    Given a route table with no routes for score or category questions, as the public one ships
    When a routed call asks a score or category question, alone or beside yes-or-no questions
    Then the whole call takes today's single classifier call, priced at the routed rate
    And the same holds for a malformed score or category question, so no text is sent twice

  @unit
  Scenario: A score or category question takes its kind's slot, else the kind's default
    Given a route table with score and category routes
    When a score or category question is routed
    Then the plan takes the job's slot the kind names for the bucket or arithmetic call
    And an arithmetic call the kind does not route apart takes its length bucket's slot
    And any slot the kind leaves out takes the kind's default, with the kind's sureness rule

  @unit
  Scenario: A sure score or category answer stays, by its kind's sureness rule
    Given a plan that escalates unsure score or category answers to an LLM
    When a score's spread is small against half its range, or a category's top option is well ahead of the runner-up
    Then the decision model's verdict is kept and the LLM is not called

  @unit
  Scenario: An unsure score or category answer escalates to the LLM leg
    Given a plan that escalates when an answer's sureness is below the threshold
    When a score is widely spread or has no distribution, or a category's top two options are close
    Then the LLM answers with a score in the range or one offered label, taken as sure
    And when the LLM answers nothing readable the decision model's verdict is kept, flagged

  @unit
  Scenario: Questions of several kinds in one call are routed per kind and merged in order
    Given a routed call asking yes-or-no, score and category questions
    When it is judged
    Then each kind is planned on its own, and the kinds are judged side by side
    And kinds whose plans share a decision-model first send send the text once with all their questions
    And a first send is shared when the primary, pair partner, input view and fallbacks are the same
    And each kind escalates from that shared answer by its own sureness rule and threshold
    And a kind the shared send answered none of is treated as its own failed send: fallbacks, then escalation
    And kinds whose plans start elsewhere send on their own, and an LLM leg still asks one question per call
    And the verdicts come back in the order asked with tokens and cost summed and each flag naming its kind
    And a kind whose run threw while another answered is a skip of that kind, keeping the paid parts billed
    And a caller's stop carries every part's paid spend

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
  Scenario: A leg past its own timeout is a failed leg, not a stopped page
    Given a decision-model leg that does not answer within its backend's timeout
    When the call is judged
    Then that leg fails as provider unavailable and its fallbacks are tried
    And the legs already paid for stay in the judgement's cost
    And only the caller's own stop is rethrown
    And time spent waiting on the rate limiter does not count against the provider timeout

  @unit
  Scenario: Decisions and LLM legs draw on the rate limiter too
    Given a routed call whose plan escalates two unsure questions to an LLM
    When it is judged
    Then the Decisions send and each LLM send wait on the rate limiter first
    And the hosted Decisions leg sends once per permit, never retrying past it
    And each leg kind draws on its own per-project share under the deployment's global cap

  @unit
  Scenario: A caller's stop keeps the legs already paid billed
    Given a routed call whose first leg answered and was paid
    When the caller stops it while a later leg is in flight
    Then the stop still reaches the caller as a stop
    And it carries what the paid legs spent, which the stopped batch bills
    And a send already in flight that answers after the stop is billed in it too
    And a judge call records that spend under a request id of its own, never the retry key
    And so the redelivery that completes under the same key is billed too

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
  Scenario: The LLM legs send one forced score or category tool call and read it back
    Given a score or category question on an Anthropic Messages or OpenAI Responses leg
    When it is asked
    Then the forced evaluation tool takes a number bounded by the range, or a label from the offered names
    And a score's framing names the asked scale and maps a scale the prompt states onto it
    And a number outside the range, or a name never offered, is no answer rather than a guess

  @unit
  Scenario: A routed judgement is priced from the summed cost of every call
    Given a routed judge call whose legs cost a known amount
    When it is priced
    Then the priced fact carries that cost times the markup, under the router's model and rate

  @unit
  Scenario: A decision-model leg is billed for its output tokens too
    Given a Decisions or Jev backend priced with an output rate
    When its leg answers and its provider reports input and output tokens
    Then the leg costs its input tokens at the input rate plus its output tokens at the output rate
    And a leg that reported output tokens alone is billed for them
    And an own decision model still bills nothing to LangWatch
    And a call with no route is still priced from its input tokens alone, as before

  @unit
  Scenario: Every judgement a routed call returns carries its cost
    Given a call that carries a route but asks a question the router does not route
    When the hosted classifier answers it
    Then the judgement carries the classifier's cost at its routed price
    And a run whose calls all carry a route never prices some of its tokens at zero

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
