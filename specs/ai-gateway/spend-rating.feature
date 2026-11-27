Feature: The spend wire rates every billed quantity and marks what it cannot price
  As an operator paying for traffic through the gateway
  I want every quantity a provider bills to reach the debit
  So that a budget never under-counts and a zero charge can be found in the ledger

  # The catalog states a flat per-query rate for the web search tool on the
  # models that offer it. The provider bills each search on top of the tokens
  # the results add. A spend row that burned quantities and still rated at zero
  # is a catalog fault; its rate version starts with "unpriced:" so a ledger
  # read can find it.

  Rule: Web search tool calls price at the catalog's per-query rate

    @unit
    Scenario: the catalog carries the per-query web search rate to the cost rule
      Given a catalog entry with a web search rate
      When the static cost rules are built
      Then the cost rule for that model carries the web search rate

    @unit
    Scenario: the cost arithmetic prices each web search call
      Given a cost rule with token rates and a web search rate
      When a call reporting tokens and two web searches is priced
      Then the total is the tokens at their rates plus two searches at the per-query rate

    @unit
    Scenario: a spend record with web searches debits them
      Given a spend record for a model the catalog prices web search on
      When the spend wire rates a request that ran three web searches
      Then the charge includes three searches at the per-query rate

    @unit
    Scenario: a spend record without a web search count rates as before
      Given a spend record from an emitter that sends no web search count
      When the spend wire rates it
      Then only the token quantities are charged

  Rule: A spend row that burned something and rated at zero is marked unpriced

    @unit
    Scenario: an unknown model with usage is stamped unpriced
      Given a spend record for a model the catalog does not carry
      When the spend wire rates a request that reported tokens
      Then the charge is zero
      And the rate version starts with "unpriced:" followed by the registry version

    @unit
    Scenario: a known model whose rule prices none of the quantities is stamped unpriced
      Given a spend record whose model rule prices characters only
      When the spend wire rates a request that reported tokens only
      Then the rate version starts with "unpriced:"

    @unit
    Scenario: a carried rate version keeps its value under the unpriced mark
      Given a spend record that carries its own rate version for an unknown model
      When the spend wire rates it
      Then the rate version is "unpriced:" followed by the carried version

    @unit
    Scenario: a priced row, a free model and an empty failure are not marked
      Given a priced request, a request on a deliberately free model and a failure with no usage
      When the spend wire rates each
      Then none of the rate versions starts with "unpriced:"
