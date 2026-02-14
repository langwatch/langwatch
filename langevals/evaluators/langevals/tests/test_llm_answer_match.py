from langevals_langevals.llm_answer_match import (
    LLMAnswerMatchEntry,
    LLMAnswerMatchEvaluator,
    LLMAnswerMatchSettings,
)


def test_llm_answer_match():
    entry = LLMAnswerMatchEntry(
        input="What genre do The Gaslight Anthem and Seaweed share?",
        output="The Gaslight Anthem and Seaweed share the genre of rock music.",
        expected_output="rock",
    )
    evaluator = LLMAnswerMatchEvaluator(
        settings=LLMAnswerMatchSettings(model="openai/gpt-5")
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
        settings=LLMAnswerMatchSettings(model="openai/gpt-5")
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
        settings=LLMAnswerMatchSettings(model="openai/gpt-5")
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == False
    assert result.details
    assert result.cost
