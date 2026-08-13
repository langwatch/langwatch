from langevals_langevals.llm_answer_match import (
    LLMAnswerMatchEntry,
    LLMAnswerMatchEvaluator,
    LLMAnswerMatchSettings,
    model_to_dspy_lm,
)


def test_model_to_dspy_lm_forces_temperature_for_gpt5():
    lm = model_to_dspy_lm("openai/gpt-5-mini")
    assert lm.kwargs.get("temperature") == 1.0


def test_model_to_dspy_lm_omits_temperature_for_newer_claude():
    # These models answer an explicit `temperature` with a hard 400 from
    # Anthropic's own API ("temperature is deprecated for this model").
    # drop_params=True only covers client-side stripping, not a server-side
    # rejection, so the key must never be sent. `None` is the sentinel both
    # dspy.LM and litellm.completion use for "not specified, use the provider
    # default" (their own signatures type it `Optional[float] = None`), so
    # omitting it here means it is never sent as a literal request field.
    for model in [
        "anthropic/claude-sonnet-5",
        "anthropic/claude-opus-5",
        "anthropic/claude-opus-4-7",
        "anthropic/claude-opus-4-8",
        "anthropic/claude-haiku-4-5-20251001",
    ]:
        lm = model_to_dspy_lm(model)
        assert lm.kwargs.get("temperature") is None, model


def test_model_to_dspy_lm_keeps_zero_temperature_for_older_claude():
    lm = model_to_dspy_lm("anthropic/claude-3-5-sonnet")
    assert lm.kwargs.get("temperature") == 0


def test_model_to_dspy_lm_keeps_zero_temperature_for_opus_below_4_7():
    # Opus deprecated `temperature` at 4.7. Every earlier Opus still accepts
    # it, so a substring test on "claude-opus-4" silently drops the pinned
    # temperature for four model versions that never needed the workaround.
    for model in [
        "anthropic/claude-opus-4-20250514",
        "anthropic/claude-opus-4-1",
        "anthropic/claude-opus-4-1-20250805",
        "anthropic/claude-opus-4-5",
        "anthropic/claude-opus-4-6",
    ]:
        lm = model_to_dspy_lm(model)
        assert lm.kwargs.get("temperature") == 0, model


def test_model_to_dspy_lm_keeps_zero_temperature_for_sonnet_below_5():
    for model in [
        "anthropic/claude-sonnet-4-5-20250929",
        "anthropic/claude-sonnet-4-6",
    ]:
        lm = model_to_dspy_lm(model)
        assert lm.kwargs.get("temperature") == 0, model


def test_model_to_dspy_lm_reads_the_version_through_a_provider_prefix():
    assert (
        model_to_dspy_lm("bedrock/anthropic.claude-opus-4-8").kwargs.get("temperature")
        is None
    )
    assert (
        model_to_dspy_lm("bedrock/anthropic.claude-opus-4-1").kwargs.get("temperature")
        == 0
    )


def test_llm_answer_match():
    entry = LLMAnswerMatchEntry(
        input="What genre do The Gaslight Anthem and Seaweed share?",
        output="The Gaslight Anthem and Seaweed share the genre of rock music.",
        expected_output="rock",
    )
    evaluator = LLMAnswerMatchEvaluator(
        settings=LLMAnswerMatchSettings(model="openai/gpt-5-mini")
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == True
    assert result.details
    assert result.cost


def test_llm_answer_match_without_question():
    entry = LLMAnswerMatchEntry(
        output="It's rock music.",
        expected_output="rock",
    )
    evaluator = LLMAnswerMatchEvaluator(
        settings=LLMAnswerMatchSettings(model="openai/gpt-5-mini")
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == True
    assert result.details
    assert result.cost


def test_llm_answer_does_not_match_match():
    entry = LLMAnswerMatchEntry(
        output="It's rock music.",
        expected_output="pop",
    )
    evaluator = LLMAnswerMatchEvaluator(
        settings=LLMAnswerMatchSettings(model="openai/gpt-5-mini")
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == False
    assert result.details
    assert result.cost
