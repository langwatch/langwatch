Feature: Prompt-cache writes are priced by how long they live

  Writing to a provider's prompt cache costs more than reading from it, and how
  much more depends on how long the entry is kept. Anthropic keeps an entry for
  five minutes at 1.25 times the input rate, or for an hour at twice the input
  rate, and publishes only the five-minute figure as a single "cache write"
  price. Our model catalog carries that one figure.

  Claude Code keeps its cache for an hour. Cache writes dominate the cost of a
  coding turn, so pricing every write as if it expired in five minutes put our
  figure around a third below what the provider actually charged. The gap was
  visible to customers: a trace's header read 0.15 USD while its terminal tab
  read 0.23, because the terminal tab showed the agent's own reported figure
  and the header showed ours.

  The fix is arithmetic, not a second source of truth. Every surface in the
  product computes cost from one formula over a span's tokens: the trace total,
  the per-span figures analytics groups by, the waterfall, the terminal tab.
  Teach that formula the two rates and give it a span that says which bucket its
  writes fell into, and every surface agrees because they were never doing
  different sums, only reading a rate we did not have.

  Scenario: The catalog's one cache-write price is the short-lived one
    Given an Anthropic model priced at 5 USD per million input tokens
    And the catalog carries a single cache write price of 6.25 USD per million
    Then that price is the five-minute rate
    And the hour-long rate is twice the input rate

  @unit
  Scenario: An hour-long cache write rate is derived for Anthropic models
    Given the catalog carries no hour-long cache write price
    When the model registry is loaded
    Then an Anthropic model's hour-long rate is twice its input rate
    And a model from another provider is given no hour-long rate

  @unit
  Scenario: A catalog that learns the real rate overrides the derived one
    Given the catalog carries its own hour-long cache write price for a model
    When the model registry is loaded
    Then that price is used rather than the derived one

  @unit
  Scenario: Each cache write bucket is priced at its own rate
    Given a call wrote 17854 tokens to an hour-long cache
    When the call is priced
    Then those tokens cost twice the input rate

  @unit
  Scenario: A call that does not say how long its cache lives is priced as before
    Given a call reports cache writes without saying which bucket they fell into
    When the call is priced
    Then those tokens cost the short-lived rate

  @unit
  Scenario: A model with no hour-long rate prices every write the same
    Given a model priced with only one cache write rate
    And a call wrote tokens to an hour-long cache
    When the call is priced
    Then those tokens cost that one rate

  @unit
  Scenario: A read never swaps in a cost only that read can see
    Given a coding agent reported its own cost for a call it made
    When the call is opened in the trace drawer
    Then the cost shown is the one computed from the call's tokens
    And it is the same figure the analytics graphs and the alerts count

  @unit
  Scenario: Every surface prices one call at one number
    Given a Claude Code call that wrote 17854 tokens to an hour-long cache
    When the call is priced for the trace header, the analytics graphs, the
      waterfall and the terminal tab
    Then all of them show what the provider charged, to a millionth of a dollar
