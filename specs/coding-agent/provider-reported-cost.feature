Feature: Provider-reported cost is the coding-agent trace's cost

  Coding-agent traces carry two possible prices for the same model call. We can
  estimate one from the call's token counts and our model-price registry, and
  some agents report the exact figure they were charged. Claude Code reports it
  on the `api_request` log event as `cost_usd`.

  Read-time enrichment already prefers the reported figure, so the terminal tab
  and the span panel show it. The trace summary never saw it, because it arrives
  on a log record while the summary's cost is folded from spans, so the drawer
  header, the traces list and analytics all showed the estimate instead. Two
  numbers for one call, differing by whatever our registry rates miss (the
  cache-creation TTL split, for one, rides the response body and never reaches
  the per-token estimate).

  The reported figure wins. It is what the provider actually charged, and using
  it everywhere is what makes the header and the terminal footer agree.

  Background:
    Given a Claude Code session exporting spans and log events to LangWatch

  @unit
  Scenario: The reported cost replaces the estimate for the whole trace
    Given a model call whose tokens estimate to 0.16 USD against the registry
    And the agent reports 0.2312 USD for that same call
    When the trace summary is folded
    Then the trace's total cost is 0.2312 USD

  @unit
  Scenario: The bundled split follows the reported cost
    Given the session runs on a flat subscription rather than per-token billing
    And the agent reports a cost for its model call
    When the trace summary is folded
    Then the trace's non-billed cost equals its total cost
    And no billed remainder appears in the cost breakdown

  @unit
  Scenario: Reported costs across a turn's calls add up
    Given a turn made three model calls
    And the agent reported a cost for each of them
    When the trace summary is folded
    Then the trace's total cost is the sum of the three reported costs

  @unit
  Scenario: The estimate stands when the agent reports nothing
    Given a session exporting spans but no log events
    When the trace summary is folded
    Then the trace's total cost is the registry estimate for its spans

  @unit
  Scenario: A reported cost of zero does not blank out the estimate
    Given a model call whose tokens estimate to a cost
    And the agent reports 0 USD for that call
    When the trace summary is folded
    Then the trace's total cost is the registry estimate

  @unit
  Scenario: Utility calls report their cost too
    Given the session made a title-generation call alongside the user's turn
    When the trace summary is folded
    Then the reported cost of the title-generation call is part of the total

  @unit
  Scenario: The drawer header and the terminal footer show one number
    Given a Claude Code trace whose model call reports a cost
    When the trace drawer opens on the terminal tab
    Then the cost in the header matches the cost in the terminal footer
