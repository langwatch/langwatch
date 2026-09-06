Feature: Long-context [1m] model id cost matching
  As a LangWatch user tracing Claude Code sessions
  I want spans reporting a 1M-context model id like "claude-opus-5[1m]"
  To resolve the platform's registry pricing for the underlying model
  So that long-context Claude Code traffic is costed, cache tokens included

  # Background
  #
  # Claude Code appends "[1m]" to the model id when the 1M-token context
  # window is active for the session, e.g. claude-opus-5[1m] or
  # claude-sonnet-4-5[1m]. The pricing registry keys models as
  # <vendor>/<model> and matches with prefix-anchored regexes (no trailing
  # anchor), so the "[1m]" suffix is absorbed by the base entry's pattern.
  #
  # Pricing policy: per Anthropic's published pricing (platform.claude.com,
  # docs/en/about-claude/pricing, "Long context pricing", retrieved
  # 2026-07-27), Claude 4.6 and later models include the full 1M-token
  # context window at standard per-token rates; there is no premium tier
  # above 200K input tokens for these models. The base registry entry's
  # rates are therefore the correct rates for the [1m] variant, including
  # the prompt-cache write (1.25x input) and cache read (0.1x input) rates.
  #
  # Regression context: a claude-opus-5[1m] trace with cache traffic showed
  # no cost. The cause was the registry itself lagging behind the model
  # launch (no claude-opus-5 entry in the deployed catalog), not the [1m]
  # suffix; these scenarios pin both halves so neither regresses.

  @bdd @trace-processing @model-cost @unit
  Scenario: A [1m] long-context model id is priced as its base model
    Given Claude Opus 5 is a priced model on the platform
    When a trace reports its model as "claude-opus-5[1m]"
    Then the trace is priced as Claude Opus 5
    And at the same standard per-token rates as traffic without the suffix

  @bdd @trace-processing @model-cost @cache-telemetry @unit
  Scenario: A Claude Code span on claude-opus-5[1m] with cache traffic gets a nonzero cost
    Given a Claude Code turn on "claude-opus-5[1m]" that mostly reads and writes prompt cache
    When the turn's trace is processed
    Then the trace shows a nonzero cost
    And the cached share is billed at Claude's cache read and cache write prices, not the fresh-input price

  @bdd @trace-processing @model-cost @unit
  Scenario: The [1m] suffix is priced as the base model across the Claude family
    Given the platform prices the current Claude models
    When traces report "claude-sonnet-4-5[1m]" or "anthropic/claude-opus-5[1m]"
    Then each is priced as its base model
