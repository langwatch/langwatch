Feature: Router models are never billed a negative cost
  As a LangWatch user sending traffic through a model router
  I want a router call never to be costed below zero
  So that my cost totals are never reduced by a price the router does not have

  # Background
  #
  # A router picks another model for each request, so it has no rate of its
  # own. The upstream model catalog marks that with a rate of -1 per token:
  # OpenRouter's own routers carry it, and so do routers other vendors publish
  # under their own name (for example nvidia/switchyard). Read as a price, -1
  # bills every token at minus one dollar, so a single routed call would knock
  # its cost off the spend, evaluation and analytics totals.
  #
  # A negative rate is treated as no rate when the catalog becomes the cost
  # registry. A router whose rates are all negative then has no registry
  # entry of its own, so it is costed the way any other model without one is.
  # When its id matches no other entry, the gateway rates the request at zero,
  # an evaluation cell gets no cost, and a trace span records a cost of zero.
  # When the fallback matcher finds another model's entry by prefix (for
  # example openrouter/pareto-code reaching unbiased/pareto), it is priced
  # from that entry, which is a separate matching problem. Either way, no
  # router is ever costed below zero.

  @unit
  Scenario: A catalog rate below zero is not used as a price
    Given the model catalog prices a router at -1 per token
    When the catalog is turned into the cost registry
    Then no registry entry carries a negative rate
    And the router has no registry entry

  @unit
  Scenario: A router name matches no registry price
    Given the model catalog prices "nvidia/switchyard" at -1 per token
    When the cost for model "nvidia/switchyard" is matched
    Then no registry entry is returned

  # Every path that writes a cost reads the same registry: the gateway spend
  # rating, the trace span cost and the evaluation cell cost. The span path
  # already drops a cost that is not above zero; the other two did not, so a
  # call routed through nvidia/switchyard rated at minus 1,500 dollars for
  # 1,000 input and 500 output tokens.

  @unit
  Scenario: A router call through the gateway never lowers spend
    Given the model catalog prices a router at -1 per token
    When a gateway request to that router is rated
    Then the spend it records is not below zero

  @unit
  Scenario: A router span on a trace is never costed below zero
    Given the model catalog prices a router at -1 per token
    When the cost of a span naming that router is computed
    Then the cost is not below zero

  @unit
  Scenario: An evaluation cell run on a router is never costed below zero
    Given the model catalog prices a router at -1 per token
    When the cost of an evaluation cell that ran that router is computed
    Then the cost is not below zero
