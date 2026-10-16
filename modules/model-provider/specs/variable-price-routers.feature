Feature: A router has no price of its own
  A router picks a model per request, so its cost is whatever that model costs.
  The upstream price sources mark a router with -1 per token. Read as a rate,
  that bills a refund: a million tokens each way through one came out at minus
  two million dollars. So the catalogue keeps -1 only as a router marker, and
  every reader of catalogue prices treats a router as unpriced. A rule that
  names the router itself still prices it.

  Rule: The cost registry never prices a router from its marker

    @unit @regression
    Scenario: The cost registry carries no negative rate
      Given the committed catalogue, which lists routers at -1 per token
      When the cost registry is built
      Then no model in it carries a negative rate

    @unit @regression
    Scenario: A router gets no cost rule of its own
      Given the committed catalogue, which lists routers at -1 per token
      When the cost registry is built
      Then no router has a rule in it

    @unit @regression
    Scenario: A router never borrows another model's cost rule
      Given a router whose id prefix-matches a priced model
      When its cost rule is matched against the registry
      Then no rule is found

    @unit @regression
    Scenario: A router id in a client's spelling borrows no cost rule
      Given a router id written in another letter case, with its provider repeated, or with a variant tag
      When its cost rule is matched against the registry
      Then no rule is found

    @unit
    Scenario: A cost rule that names the router still prices it
      Given a project rule whose pattern is the router's plain id
      When the router's cost rule is matched, in any client's spelling
      Then that rule is the match

  Rule: The registry sync writes the marker, never a refund

    @unit @regression
    Scenario: A negative OpenRouter price becomes the router marker
      Given OpenRouter prices a model at -1 per token
      When the model's catalogue pricing is built
      Then its input and output rates are the router marker
      And the catalogue reads it as a router

    @unit
    Scenario: A model with no stated price is not a router
      Given OpenRouter states no price for a model
      When the model's catalogue pricing is built
      Then its input and output rates are zero
      And the catalogue does not read it as a router

  Rule: Every cost path leaves a router unpriced

    @unit @regression
    Scenario: A span through a router is never costed below zero
      Given a span priced as a router, because its model names one
      When the span is costed from the registry
      Then its cost is zero

    @unit @regression
    Scenario: A gateway request through a router is never rated below zero
      Given a gateway request whose model is a router
      When the request is rated
      Then its cost is zero

    @unit
    Scenario: A gateway request through a router names the missing rule
      Given a gateway request whose model is a router
      When the request's rating faults are found
      Then the only fault is the missing rate rule

    @unit @regression
    Scenario: A DSPy step's call through a router is left unpriced
      Given a DSPy step whose LLM response names a router as its model
      When the call is priced
      Then the call has no cost

    @unit @regression
    Scenario: The evaluator price table skips a router
      Given a catalogue with a router at -1 per token and a priced model
      When the evaluator's price table is built
      Then only the priced model is in it
