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
    Given a route table whose slot names no instant entry, or an escalation with neither a threshold nor a gate
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
  Scenario: A gate names a hosted classifier backend and an escalation, nothing else
    Given a route table whose entry carries a gate
    When the deployment boots
    Then the entry must name an escalation, and neither a threshold nor a pair
    And the gate's backend must be a hosted classifier backend with no fallbacks
    And the gate's question must be one the code names, and its threshold at most the question's top level
    And the gate's backend needs a price and a key like any backend the entry can call
    And an entry whose gate backend is switched off is unusable, so its mode falls back

  @unit
  Scenario: The gate reads a frozen framing of the case
    Given a gated plan
    When a question is routed
    Then the gate's backend is asked one score question about how hard the case is to judge
    And its levels are sent by name, easiest first, and the score read back is the weighted mean level index
    And a level read back in another case or with surrounding space counts as that level
    And a question that names its levels with any range other than 0 to the last level index is refused before any call
    And it reads the job, the question's first 3,000 characters and the full text
    And a text over 12,000 characters is shown as its first and last 6,000 with the cut length between
    And the wording and the cut are fixed under the question's name, so a threshold keeps its meaning

  @unit
  Scenario: A gate sends an easy case to the primary alone and the rest to the escalation alone
    Given a gated plan with a threshold
    When the gate scores the case under the threshold
    Then the primary answers alone, however unsure, and the escalation is not called
    When the gate scores the case at or above the threshold
    Then the escalation answers alone on the full text, and the primary is not called
    And the judgement counts no escalation, flags the branch taken and sums the gate's cost and that one call's
    And the gate's limiter wait counts toward the judgement's limiter wait, with that one call's
    And a gated plan never shares its first send with another kind's plan

  @unit
  Scenario: A gate that gives no score sends the case to the escalation
    Given a gated plan
    When the gate fails, runs past its timeout or answers with no readable score or a level outside its question's
    Then the escalation answers alone, the routing flags that no score was read
    And whatever the gate billed is still billed

  @unit
  Scenario: A gated branch that cannot answer is answered by the other backend, flagged
    Given a gated plan
    When the gate picks the primary and the primary cannot answer
    Then the escalation answers, flagged as a failed primary and counted as one escalation
    When the gate picks the escalation and the escalation cannot answer
    Then the primary answers, flagged as a failed hard branch
    And when neither answers the judgement is skipped with the platform's skip reason, the gate still billed
    And a branch whose backend lists the other as a fallback still asks each backend at most once

  @unit
  Scenario: A gate rates each question of a call on its own
    Given a gated plan and a call that asks two yes-or-no questions
    When the call is routed
    Then the gate is asked once per question, since it reads the question as the task
    And the easy question is answered by the primary and the other by the escalation, side by side
    And the judgement's limiter wait is the longest gate send's and the longer branch's, never their sum

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
  Scenario: A reasoning effort is sent only when the backend sets one
    Given an OpenAI Responses backend whose table entry sets a reasoning effort
    When its leg is asked
    Then the request names that effort, and the reasoning tokens it reports are billed as output
    And an effort other than none raises the request's output cap from 8,000 to 32,000 tokens
    And an answer the provider stopped before the evaluation call is no answer, its tokens billed and its stop reason logged
    And a backend that sets none sends the request it sent before, with no effort named
    And the table refuses an effort on any other backend kind, or one the provider does not name

  @unit @regression
  Scenario: A backend that reasons waits long enough to write its output cap
    Given an OpenAI Responses backend whose table entry sets a reasoning effort other than none
    When the table is read
    Then its timeout defaults to 300,000 ms where the entry names none
    And an entry that names a shorter timeout is refused, naming the backend and the floor
    And a backend with no effort, or effort none, keeps the 30,000 ms default
    And an LLM backend may set its own output cap, sent on every call and refused on any other kind
    And a reasoning backend with its own cap needs only the time to write it at 50 tokens a second, its default timeout
    And an answer cut at that cap is no answer, its tokens billed, so the backend's fallback answers

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
  Scenario: The router flag is on by default on LangWatch Cloud
    Given the feature flag registry
    When the router flag is read with no targeting rule on LangWatch Cloud
    Then it is on, so the LLM-judge caller sends a route

  @unit
  Scenario: The router flag is off by default on a self-hosted install
    Given a self-hosted install, where IS_SAAS is unset
    When the router flag is read with no operator row and no override
    Then it is off, so the LLM-judge caller sends no route
    And the judge picker names LangWatch's hosted model LangWatch Instant (preview), never LangWatch Evals (preview)
    And an operator can still switch it on for the install

  @unit
  Scenario: Routed search has its own rollout flag, off everywhere by default
    Given the feature flag registry
    When the search router flag is read with no targeting rule, on LangWatch Cloud or self-hosted
    Then it is off, so no judged query sends the "search" route until a rule turns it on

  # --- A judged query's cost ceiling (ADR-190 decision 13) ---

  @unit
  Scenario: Under a cost ceiling each send holds its worst case first
    Given a routed call that carries a cost ceiling with room left
    When the router sends a leg
    Then it first holds that send's worst-case cost on the ceiling
    And once the send answers the hold is swapped for what the send was billed
    And a gate send holds its worst case on the gate's own framed text, settled like any send
    And a gate the ceiling refuses is not sent, so its question goes the hard way, flagged "cost_ceiling"
    And a long trace is held at what its channel can send, so it is not refused for bytes it never sends
    And a send billed past its worst case, the unrouted classifier call included, is logged at error

  @unit @regression
  Scenario: A send that throws frees its hold on the ceiling
    Given a routed call that carries a cost ceiling with room left
    When an unrouted classifier call throws, or the caller's stop makes a routed send throw
    Then the send's hold is let go with nothing billed for it
    And no send waiting on the ceiling behind it waits forever

  @unit @regression
  Scenario: An LLM call that went out with no usage back keeps its hold on the ceiling
    Given a routed call that carries a cost ceiling
    When an LLM call times out or loses its socket after it was sent, so no usage comes back
    Then the channel marks the skip as usage unread
    And its send settles on the ceiling at its whole hold, so the room left for the next send shrinks
    And the customer is billed nothing for that call

  @unit
  Scenario: A send whose worst case passes the ceiling is not sent
    Given a routed call whose ceiling has room for the primary's worst case but not the escalation's
    When the primary answers unsure
    Then the LLM leg is never called
    And the primary verdict is kept, flagged "escalation_failed" and "cost_ceiling"
    And a ceiling without room for the primary sends nothing and skips the text as "query_cost_ceiling"

  @unit
  Scenario: A kind the table does not route holds the classifier's worst case too
    Given a routed call with a cost ceiling that asks a question the table does not route
    When the ceiling has no room for the classifier's worst case
    Then the classifier is not called and the text is skipped as "query_cost_ceiling", never as rate limited
    And the refusal is logged at warn on the router's logger, since it carries no routing flags

  @unit
  Scenario: A send's worst case bounds what it can bill
    Given a backend's prices and a text with its questions
    When its worst-case cost is read
    Then it prices every UTF-8 byte of what is sent as a token, plus a fixed slack per send
    And it counts the text as the backend's channel fits it: an LLM's content budget, or the budget the questions leave a decision model
    And it takes the dearer of the base and long-context rates
    And an LLM adds its output cap at its output rate: its own cap where the table sets one, else the reasoning cap where an effort is set
    And an LLM or Decisions backend is counted once per question, Jev once for all
    And a backend with no price can never be held

  # --- The LLM-judge caller (ADR-190 open question 2: one caller behind the flag) ---

  # LangWatch Evals (preview) is the router: the picker saves it as langwatch/instant-evals, the id the
  # previous release reads, and langwatch/evals-preview reads the same. The LangWatch Instant (preview) id,
  # langwatch/instant-preview, is the hosted decision model alone, never routed (ADR-182).

  @unit
  Scenario: An LLM judge on LangWatch Evals (preview) is routed when the flag is on
    Given the router flag is on for the project's organization
    And an LLM judge evaluation whose model is LangWatch Evals (preview)
    When it runs on Instant Evals
    Then the judge call carries the route for the "llm_judge" job
    And the flag is read for the project within its organization, so an organization rule applies

  @unit
  Scenario: An LLM judge on LangWatch Instant (preview) is never routed
    Given the router flag is on for the project's organization
    And an LLM judge evaluation whose model is LangWatch Instant (preview)
    When it runs on Instant Evals
    Then the judge call carries no route
    And the router flag is not read

  @unit
  Scenario: A judge saved on langwatch/instant-evals, the id the picker writes, is routed
    Given the router flag is on for the project's organization
    And an LLM judge evaluation whose model is stored as "langwatch/instant-evals"
    When it runs on Instant Evals
    Then the judge call carries the route for the "llm_judge" job, as before the split

  @unit
  Scenario: With the router flag off an LLM judge keeps today's single classifier call
    Given the router flag is off for the project's organization
    And an LLM judge evaluation whose model is LangWatch Evals (preview)
    When it runs on Instant Evals
    Then the judge call carries no route

  @unit
  Scenario: An own decision model is never routed
    Given the router flag is on for the project's organization
    And the project runs Instant Evals on its own decision model
    When an LLM judge evaluation runs on Instant Evals
    Then the judge call carries the own decision model and no route
    And the router flag is not read

  @unit
  Scenario: A routed result names the LangWatch Judge, never a backend
    Given a routed judgement that the decision model answered and the LLM leg escalated
    When the evaluation result is built
    Then its details name the LangWatch Judge
    And they say how many questions were escalated
    And they name no backend that answered
    And an unrouted result's details read exactly as before
