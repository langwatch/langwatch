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
    # Claude 5th-gen models reject any explicit `temperature` outright
    # ("temperature is deprecated for this model") as a hard 400 from
    # Anthropic's own API — drop_params=True doesn't cover a server-side
    # rejection, only client-side stripping, so the fix is to never send
    # the key. `None` is the documented sentinel both dspy.LM and
    # litellm.completion use for "not specified, use provider default" —
    # confirmed via their own `Optional[float] = None` signatures — so
    # omitting it here means it's never sent as a literal request field.
    for model in [
        "anthropic/claude-sonnet-5",
        "anthropic/claude-opus-4-8",
        "anthropic/claude-haiku-4-5-20251001",
    ]:
        lm = model_to_dspy_lm(model)
        assert lm.kwargs.get("temperature") is None


def test_model_to_dspy_lm_keeps_zero_temperature_for_older_claude():
    lm = model_to_dspy_lm("anthropic/claude-3-5-sonnet")
    assert lm.kwargs.get("temperature") == 0


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
