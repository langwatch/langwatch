# pi model calls: the first agent that is both span-fed and self-costing
#
# Implementation:
#   packages/span-normalisation/src/genAiCanonicaliser.ts        (the convention attributes pi dual-writes)
#   packages/span-normalisation/src/spanCanonicalisation.ts      (the ordered chain a pi extractor registers into)
#   packages/span-normalisation/src/costAttribution.ts           (the catalogue price of a call's tokens)
#   modules/coding-agent/process/src/eventing/coding-agent-session-span.projection.ts (where pi's reported figure accumulates)
#   modules/coding-agent/process/src/eventing/coding-agent-cost-drift.subscriber.ts (where the two figures meet as a drift signal)
#   modules/coding-agent/contract/src/telemetry/coding-agent-span.ts (which span names count as model calls)
#   modules/coding-agent/contract/src/coding-agent-transcript-span.ts (model call versus tool run)
#
# Related specs:
#   specs/trace-processing/coding-agent-cost.feature         , the house cost rule pi joins
#   specs/coding-agent/pi-sessions.feature                   , the session these calls roll up into
#   specs/coding-agent/cache-write-ttl-pricing.feature       , how cache writes are priced
#   specs/coding-agent/context-economics.feature             , what the token types are read for
#   specs/ai-governance/ingestion-sources/pi-cli-otlp.feature, where the attributes are lifted
#   specs/ai-governance/ingestion-sources/native-receiver-lift.feature, the generic GenAI lift pi relies on
#
# Motivation: span-fed agents have always been priced from the model catalogue,
# and self-reporting agents have always reported on log records. pi is both: it
# sends model calls as `pi.ai.request` spans and puts its own cost on
# `pi.ai.usage.cost`. That is not a precedence question, because the house rule
# already answers it: the catalogue-computed figure is the charge, and what an
# agent says it was billed accumulates beside it. Only an agent with no
# token-bearing span is charged at its own figure, and pi has one on every call.
#
# So the reason to write pi down is the drift signal. Two figures that disagree
# mean either our price registry or pi's own pricing went stale, and letting
# pi's figure replace the charge is exactly what destroys that alarm.
#
# The second hazard is a model nobody prices. Recording zero for it reads as a
# free call and silently understates a bill, so an unpriced call stays unpriced
# whatever pi costed it at. And pi sells no unit of its own, so no AI-unit
# figure is read off its spans: inventing one would bill a customer for a
# product they did not buy.
#
# Bound in modules/coding-agent/process/src/eventing/__tests__/pi-session.unit.test.ts
# and the cost-drift subscriber test. Three stay @unimplemented, each naming the
# tag it becomes, for the reason above it: the coding-agent lane has no reasoning
# token type, and a span-fed call's per-call row writes no stop reason and no
# error type for any agent. A scenario still carrying @unimplemented when
# ADR-188 is called done is work that was not done.

Feature: pi model calls, tokens and cost
  Each call's attributes are dual-written. pi's own keys carry what the GenAI
  conventions have no name for, and the convention keys carry the rest, so the
  generic GenAI arms of the pipeline admit, fold and price pi with no pi-shaped
  branch.

Rule: A pi model call is read through the generic GenAI path

  @unit
  Scenario: A pi.ai.request span is recognised as a model call
    Given a pi.ai.request span carrying the dual-written GenAI attributes
    When the span is stamped, folded and shown in the trace browser
    Then all three treat it as a model call

  @unit
  Scenario: Each model call writes one per-call row under its session
    Given a pi session with two model calls
    When they are folded
    Then two per-call rows exist under that session
    And each carries its own model, token counts and computed cost

Rule: pi's full token taxonomy survives, including what the conventions cannot name

  @unit
  Scenario: Cache read and cache write tokens are kept apart
    Given a pi.ai.request span reporting cache read and cache write tokens
    When the model-call facts are lifted
    Then the cache read and cache write counts are recorded separately

  # Parked: the canonical gen_ai.usage.reasoning_tokens is not on the contribution allowlist,
  # and neither the session row nor the per-call row has a reasoning count to put it in.
  # becomes @unit
  @unimplemented
  Scenario: Reasoning tokens are recorded rather than folded into output
    Given a pi.ai.request span reporting reasoning tokens
    When the model-call facts are lifted
    Then the reasoning tokens are recorded as their own token type

  @unit
  Scenario: A call that reports a total but no breakdown is not double counted
    Given a pi.ai.request span reporting only a total token count
    When the model-call facts are lifted
    Then the total is not added on top of the per-type counts

Rule: The catalogue computes the charge and pi's own figure accumulates beside it

  # Reported-wins is granted to a logs-only agent alone, because it has no
  # token-bearing span to compute from. pi has one on every call, so it is
  # charged the way every span-fed agent is.

  @unit
  Scenario: A call is charged the catalogue price of its tokens, not pi's figure
    Given a pi.ai.request span whose pi.ai.usage.cost differs from the catalogue price
    When the call is priced
    Then the charge is the catalogue price of its tokens
    And pi's reported figure does not change the charge

  @unit
  Scenario: pi's reported cost accumulates on the session as a figure of its own
    Given a pi session whose two calls each carry pi.ai.usage.cost
    When the session is folded
    Then the session's reported figure is the sum of the two reported amounts
    And the session's cost is still the catalogue price of the same calls

  @unit
  Scenario: The two figures disagreeing is readable, not reconciled away
    Given a folded pi session whose reported figure and computed cost differ
    When the session is read
    Then both figures are readable side by side
    # That is the alarm: either our price registry or pi's own pricing went
    # stale. Overwriting one with the other is what loses it.

  @unit
  Scenario: A model the catalogue does not price is recorded as unpriced, whatever pi costed it
    Given a pi.ai.request span carrying pi.ai.usage.cost for a model the catalogue does not price
    When the call is priced
    Then the call is recorded as unpriced rather than as zero
    And pi's reported amount still accumulates on the session

  @unit
  Scenario: The session cost is the sum of its per-call charges
    Given a pi session of two priced calls
    When the session is folded
    Then the session cost equals the sum of the two per-call charges

  @unit
  Scenario: pi sells no unit of its own, so no AI units are claimed from its spans
    Given a pi session of priced calls
    When the session is folded
    Then its AI units are zero
    And no AI-unit attribute is read from pi's spans

Rule: pi's own response facts are not lost in the dual write

  # Parked: a span-fed per-call row leaves its stop reason blank, and the fold reads only stop_reason.
  # becomes @unit
  @unimplemented
  Scenario: pi's stop reason is recorded as pi reported it
    Given pi.ai.request spans ending with each of pi's stop reasons
    When the model-call facts are lifted
    Then each stop reason is recorded as pi's own value

  # Parked: a span-fed per-call row leaves its error type blank and counts every call as a call.
  # becomes @unit
  @unimplemented
  Scenario: A failed provider call records pi's error type
    Given a pi.ai.request span that ended in a provider error
    When the model-call facts are lifted
    Then pi's error type is recorded
    And the call is not counted as a successful model call
