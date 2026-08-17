import threading

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


def test_llm_answer_match_runs_from_multiple_worker_threads():
    """The server dispatches each request to a threadpool worker thread.

    dspy pins global-settings ownership to the first thread that calls
    `dspy.settings.configure`; a long-lived server that configured from one
    worker thread then raised "dspy.settings can only be changed by the thread
    that initially configured it." for every evaluation landing on any other
    thread. The evaluator must not touch global dspy settings at all.
    """
    entry = LLMAnswerMatchEntry(
        input="What genre do The Gaslight Anthem and Seaweed share?",
        output="The Gaslight Anthem and Seaweed share the genre of rock music.",
        expected_output="rock",
    )
    results: list = []
    errors: list = []

    def run():
        try:
            evaluator = LLMAnswerMatchEvaluator(
                settings=LLMAnswerMatchSettings(model="openai/gpt-5-mini")
            )
            results.append(evaluator.evaluate(entry))
        except Exception as error:
            errors.append(error)

    for _ in range(2):
        thread = threading.Thread(target=run)
        thread.start()
        thread.join()

    assert errors == []
    assert len(results) == 2
    assert all(result.status == "processed" for result in results)


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
