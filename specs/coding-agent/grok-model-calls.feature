# Grok model calls, tokens and cost from the api_request event
#
# Implementation:
#   modules/coding-agent/contract/src/telemetry/grok.ts                    (declares cache-inclusive input and micro-dollar cost)
#   modules/coding-agent/process/src/rules/coding-agent-log-facts.rules.ts (restates input and cost before the fact allowlist drops them)
#   modules/coding-agent/contract/src/telemetry/coding-agent-normalization.ts (token types, already maps Grok's)
#   modules/coding-agent/process/src/eventing/coding-agent-session-log.projection.ts (foldApiRequest)
#   modules/coding-agent/process/src/eventing/coding-agent-session-events.projection.ts (the per-call fact rows)
#
# Related specs:
#   specs/coding-agent/grok-sessions.feature
#   specs/coding-agent/context-economics.feature, cache read versus cache write pricing
#   specs/trace-processing/fresh-input-tokens.feature, the same restatement for spans
#
# Motivation: one Grok api_request is one model call, as it is for Claude Code
# and Cowork, and for a logs-only agent that event IS the call. Two Grok
# figures differ from Claude's:
#   - `input_tokens` INCLUDES `cache_read_tokens` (the OpenAI convention;
#     captured: cache_read 25,728 inside input 25,852). Claude's input is
#     disjoint from its cache buckets, and the fold sums them, so a Grok input
#     taken as-is would count every cached token twice.
#   - cost is `cost_usd_micros`, an integer, where Claude sends `cost_usd`.
#
# Both are restated in the log-facts rule, declared on the definition as
# Codex's span quirks are, because the fact allowlist keeps `input_tokens` and
# `cost_usd` but drops `cost_usd_micros`. The session fold stays untouched.
# Reasoning tokens are not folded for any agent; Grok's ride its output.

Feature: Grok model calls

Rule: Each api_request is one model call

  @unit
  Scenario: A Grok api_request becomes one model call on its session
    Given a grok_code.api_request with model "grok-4.7", input 25852, cache_read 25728 and output 98
    When the session is folded
    Then the session has one model call on "grok-4.7"
    And its fresh input is 124, its cache read 25728 and its output 98

  @unit
  Scenario: Input is never counted again with the cache added on top
    Given a Grok session of four api_requests, each with cache reads
    When the session is folded
    Then the row's total tokens equal the sum of each call's stated input and output
    And no cache read token is counted twice

  @unit
  Scenario: A Grok call with no cache read keeps its whole input as fresh
    Given a grok_code.api_request with input 10780 and cache_read 0
    When the session is folded
    Then its fresh input is 10780

  @unit
  Scenario: A cache read larger than the stated input never yields negative input
    Given a grok_code.api_request whose cache_read exceeds its input
    When the session is folded
    Then its fresh input is 0

Rule: Grok's reported cost is kept beside the computed one

  @unit
  Scenario: cost_usd_micros becomes the reported cost in dollars
    Given a grok_code.api_request with cost_usd_micros 51116
    When the session is folded
    Then the session's agent-reported cost is 0.051116 dollars

  # A logs-only agent has no token-bearing span to compute a cost from, so its
  # reported figure is also the session's cost, as it is for Cowork.
  @unit
  Scenario: The reported cost is the session cost
    Given a Grok session of two api_requests, each with cost_usd_micros
    When the session is folded
    Then the session cost equals the sum of the reported costs
    And so does the agent-reported cost

  @unit
  Scenario: Each per-call row carries its own reported cost
    Given a grok_code.api_request with cost_usd_micros 51116
    When its per-call fact row is written
    Then the row's cost is 0.051116 dollars and its fresh input excludes the cache read

Rule: Grok's metrics never double the log figures

  @unit
  Scenario: grok_code.token.usage and grok_code.cost.usage do not add to the session's call totals
    Given a Grok session whose api_request events and token and cost metrics describe the same calls
    When the session is folded
    Then the session's tokens and cost equal the api_request figures alone

  @unit
  Scenario: Grok's token metric types map onto the canonical buckets
    Given grok_code.token.usage points typed input, output, reasoning and cache_read
    When their token types are normalised
    Then they map to input, output, reasoning and cache_read
