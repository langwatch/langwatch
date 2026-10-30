Feature: pi model calls, tokens and cost
  ADR-188 Decisions 6 and 7. pi sends its model calls on spans, named
  `pi.ai.request`, and reports the cost of each call itself on
  `pi.ai.usage.cost`. That combination is new here: span-fed agents have been
  priced from the model catalogue and self-reporting agents have reported on log
  records. pi is both, so the precedence is written down rather than inferred.

  Each call's attributes are dual-written. pi's own keys carry what the GenAI
  conventions have no name for, and the convention keys carry the rest, so the
  generic GenAI arms of the pipeline admit, fold and price pi with no pi-shaped
  branch.

  Pairs with:
    - specs/coding-agent/pi-sessions.feature
    - specs/coding-agent/cache-write-ttl-pricing.feature
    - specs/coding-agent/context-economics.feature

  Rule: A pi model call is read through the generic GenAI path

    @unit
    Scenario: A pi.ai.request span is recognised as a model call
      Given a pi.ai.request span carrying the dual-written GenAI attributes
      When the span is tested for a model call
      Then it is a model call

    @unit
    Scenario: The model call's operation role comes from the GenAI operation name
      Given a pi.ai.request span whose GenAI operation name is a chat completion
      When its operation role is resolved
      Then the role is resolved from the convention attribute, with no pi-specific branch

    @unit
    Scenario: Each model call writes one per-call row under its session
      Given a pi session with two model calls
      When they are folded
      Then two per-call rows exist under that session
      And each carries its own model and token counts

  Rule: pi's full token taxonomy survives, including what the conventions cannot name

    @unit
    Scenario: Input and output tokens are read from the convention attributes
      Given a pi.ai.request span reporting input and output tokens
      When the model-call facts are lifted
      Then the input and output token counts are taken from the GenAI attributes

    @unit
    Scenario: Cache read and cache write tokens are kept apart
      Given a pi.ai.request span reporting cache read and cache write tokens
      When the model-call facts are lifted
      Then the cache read and cache write counts are recorded separately

    @unit
    Scenario: Reasoning tokens are recorded rather than folded into output
      Given a pi.ai.request span reporting reasoning tokens
      When the model-call facts are lifted
      Then the reasoning tokens are recorded as their own token type

    @unit
    Scenario: A call that reports a total but no breakdown is not double counted
      Given a pi.ai.request span reporting only a total token count
      When the model-call facts are lifted
      Then the total is not added on top of the per-type counts

  Rule: Reported cost wins; the catalogue is the fallback

    @unit
    Scenario: pi's reported cost is used when pi reports one
      Given a pi.ai.request span carrying pi's reported cost
      And the model catalogue prices that model differently
      When the call is priced
      Then the reported cost is used

    @unit
    Scenario: Catalogue pricing is used when pi reports no cost
      Given a pi.ai.request span carrying no reported cost
      And the model catalogue prices that model
      When the call is priced
      Then the catalogue price of its tokens is used

    @unit
    Scenario: A model the catalogue does not price and pi does not cost is reported as unpriced
      Given a pi.ai.request span with no reported cost for a model the catalogue does not price
      When the call is priced
      Then the call is recorded as unpriced rather than as zero

    @unit
    Scenario: The session cost is the sum of its per-call costs, whichever source priced each
      Given a pi session whose two calls were priced from different sources
      When the session is folded
      Then the session cost equals the sum of the two per-call costs

    @unit
    Scenario: pi sells no unit of its own, so no AI units are claimed from its spans
      Given a pi session priced from reported cost
      When the session is folded
      Then its AI units are zero
      And no AI-unit attribute is read from pi's spans

  Rule: pi's own response facts are not lost in the dual write

    @unit
    Scenario: pi's stop reason is recorded as pi reported it
      Given pi.ai.request spans ending with each of pi's stop reasons
      When the model-call facts are lifted
      Then each stop reason is recorded as pi's own value

    @unit
    Scenario: A failed provider call records pi's error type
      Given a pi.ai.request span that ended in a provider error
      When the model-call facts are lifted
      Then pi's error type is recorded
      And the call is not counted as a successful model call
