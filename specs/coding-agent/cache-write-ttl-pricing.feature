Feature: Prompt-cache writes are priced by how long they live

  Writing to a provider's prompt cache costs more than reading from it, and how
  much more depends on how long the entry is kept. Anthropic keeps an entry for
  five minutes at 1.25 times the input rate, or for an hour at twice the input
  rate, and publishes only the five-minute figure as a single "cache write"
  price. Our model catalog carries that one figure.

  Cache writes dominate the cost of a coding turn, so the rate they are priced
  at moves the bill. The formula is arithmetic, not a second source of truth:
  every surface in the product computes cost from one formula over a span's
  tokens, the trace total, the per-span figures analytics groups by, the
  waterfall and the terminal tab. Teach that formula the two rates and give it a
  span that says which bucket its writes fell into, and every surface agrees
  because they were never doing different sums, only reading a rate we did not
  have.

  Which bucket a write fell into is something only the provider can say for
  sure. The gateway lanes read Anthropic's own breakdown off the response body
  and put it on the span, and a span that already states an hour-long count
  keeps it. A Claude Code span says how many tokens were written but not how
  long they live, so its main-thread calls, which Claude Code writes to the
  hour-long cache, are recorded as hour-long writes and its other calls as
  short-lived ones. The trace's per-span costs, the session's cost and each pull
  request's model lines all price those same tokens with this one formula, so
  they state one figure.

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
  Scenario: An hour-long cache write is recorded only where the provider states it
    Given a Claude Code call that wrote 17854 tokens to its cache
    And the span does not say how long the entry lives
    When the span is canonicalised
    Then it records the tokens written
    And it records no hour-long cache write count

  @unit
  Scenario: Every surface prices one call at one number
    Given a Claude Code call that wrote 17854 tokens to its cache
    When the call is priced for the trace header, the analytics graphs, the
      waterfall and the terminal tab
    Then all of them show the same figure, to a millionth of a dollar

  @unit
  Scenario: A custom model cost can set its own hour-long cache write rate
    Given a project sets its own hour-long cache write rate for a model
    When a call to that model is priced
    Then the hour-long writes cost the project's rate rather than the catalog's
