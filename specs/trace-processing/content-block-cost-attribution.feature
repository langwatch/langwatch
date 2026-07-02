Feature: Content-block cost attribution for coding-agent traces

  Coding-agent traces (Claude Code, Codex) carry full message content. At
  ingestion, each content block is classified into a cost category (system
  prompt, user input, MCP tool definitions, skill content, tool results,
  thinking, ...) and the span's real provider-reported token usage is split
  across those categories, cache-tier aware. The result answers "where does
  my coding-agent spend actually go" with numbers that always sum to the
  real bill. Analytics only — these numbers never feed billing or quotas.
  (ADR-033)

  Background:
    Given the trace processing pipeline is running

  # --- Classification --------------------------------------------------------

  @unit
  Scenario: Content blocks of a coding-agent span are classified into cost categories
    Given a coding-agent span with captured message content containing a system prompt, a user message, and a tool result
    When the span is processed
    Then the span carries a block classification listing each block with its category

  @unit
  Scenario: MCP tool activity is distinguished from built-in tool activity
    Given a coding-agent span whose content includes a call to an MCP-prefixed tool and a call to a built-in tool
    When the span is processed
    Then the MCP call is categorised as MCP tool activity
    And the built-in call is categorised as built-in tool activity

  @unit
  Scenario: Injected context markers are classified separately from real user input
    Given a coding-agent span whose user message starts with injected context blocks followed by the user's actual request
    When the span is processed
    Then the injected context is not categorised as user input
    And the user's actual request is categorised as user input

  @unit @unimplemented
  Scenario: A span from a non-coding-agent source is not classified
    Given a span with message content that does not come from a coding-agent harness
    When the span is processed
    Then the span carries no block classification
    And the span is stored normally

  # --- Cost conservation -----------------------------------------------------

  @unit
  Scenario: Per-category costs sum exactly to the span's real cost
    Given a coding-agent span with captured content and provider-reported token usage
    When the span is processed
    Then the sum of all category costs equals the span's total cost

  @unit
  Scenario: Costs are conserved on the first turn of a session with cache creation
    Given a coding-agent span reporting cache-creation tokens and no cache-read tokens
    When the span is processed
    Then the sum of all category costs equals the span's total cost

  @unit
  Scenario: Cached prefix categories are priced at the cache-read rate
    Given a coding-agent span whose prefix blocks were served from cache
    When the span is processed
    Then the categories in the cached prefix are priced at the cache-read rate
    And the categories after the prefix are priced at the fresh-input rate

  @unit
  Scenario: Usage with no attributable blocks lands in the catch-all category
    Given a coding-agent span reporting token usage but whose content is truncated to nothing attributable
    When the span is processed
    Then the unattributable usage is recorded under the catch-all category
    And no usage is dropped

  # --- Safety invariants -----------------------------------------------------

  @unit @unimplemented
  Scenario: Classification failure never fails ingestion
    Given a coding-agent span with malformed message content
    When the span is processed
    Then the span is stored without a block classification
    And no error is surfaced to the ingestion caller

  @unit @unimplemented
  Scenario: A span without captured content is skipped silently
    Given a coding-agent span whose payload capture is disabled
    When the span is processed
    Then the span carries no block classification
    And no error is surfaced

  @unit @unimplemented
  Scenario: Customer-supplied classification attributes are discarded at ingestion
    Given an ingested span carrying a forged block classification attribute
    When the span is processed
    Then the forged classification is stripped before storage

  @unit
  Scenario: Classification is deterministic for replay
    Given the same coding-agent span processed twice with the same classifier version
    When both results are compared
    Then the block classifications are identical
