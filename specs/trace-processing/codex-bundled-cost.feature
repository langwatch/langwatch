Feature: Codex bundled cost
  As a LangWatch user running Langy or assists on the codex provider
  I want codex turns to show what they would have cost on the OpenAI API
  Marked as bundled rather than billed
  So that subscription-backed usage reads as plan usage, not as a missing cost

  # Background
  #
  # The codex provider ("sign in with OpenAI") bills the user's ChatGPT plan,
  # never per token, so the model catalog prices codex models at zero. The
  # cost pipeline must still compute the list-price cost from the underlying
  # OpenAI model's pricing and classify it with the same non-billable marker
  # Claude Code subscription usage gets (`langwatch.cost.non_billable`), so
  # the trace explorer shows the "Bundled" presentation instead of a dash.
  #
  # The gateway reports codex spans with `gen_ai.provider.name = openai_codex`
  # and the bare underlying model id (e.g. "gpt-5.6-terra"); other emitters
  # may carry the full `openai_codex/<model>` id. Both spellings must price
  # from the `openai/<model>` registry entry.

  @unit
  Scenario: A codex-prefixed model id prices from the underlying OpenAI entry
    Given the pricing registry has an entry for "openai/gpt-5.6-terra"
    When the cost for model "openai_codex/gpt-5.6-terra" is matched
    Then the "openai/gpt-5.6-terra" registry entry is returned

  @unit
  Scenario: The bare model id behind the codex provider prices from the OpenAI entry
    Given the pricing registry has an entry for "openai/gpt-5.6-terra"
    When the cost for model "gpt-5.6-terra" is matched
    Then the "openai/gpt-5.6-terra" registry entry is returned
    And the entry carries positive per-token rates

  @unit
  Scenario: A gateway codex span is stamped with the non-billable marker
    Given a span reporting provider name "openai_codex"
    When the span is canonicalised
    Then the span carries the non-billable cost marker

  @unit
  Scenario: A span running a codex-prefixed model is stamped with the non-billable marker
    Given a span whose request model id starts with "openai_codex/"
    When the span is canonicalised
    Then the span carries the non-billable cost marker

  @unit
  Scenario: An explicit wire-level non-billable marker is left untouched
    Given a codex span that already carries an explicit non-billable marker value
    When the span is canonicalised
    Then the marker keeps its wire value

  @unit
  Scenario: A codex span's computed cost is classified as bundled
    Given a canonicalised codex span with token usage
    When its per-span cost is derived
    Then the cost is greater than zero
    And the whole cost is recorded as the non-billed portion
