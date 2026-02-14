from langevals_langevals.exact_match import (
    ExactMatchEvaluator,
    ExactMatchEntry,
    ExactMatchSettings,
)


def test_langeval_exact_match_evaluator():
    entry = ExactMatchEntry(
        output="What is the capital of France?",
        expected_output="What is the capital of France?",
    )
    settings = ExactMatchSettings()

    evaluator = ExactMatchEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.passed == True


def test_langeval_exact_match_evaluator_defaults():
    entry = ExactMatchEntry(
        output="What is the capital of France?",
        expected_output="What is the capital of the Netherlands?",
    )
    settings = ExactMatchSettings()

    evaluator = ExactMatchEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.passed == False


def test_langeval_exact_match_case_sensitive_true():
    entry = ExactMatchEntry(
        output="Hello World",
        expected_output="hello world",
    )
    settings = ExactMatchSettings(case_sensitive=True)

    evaluator = ExactMatchEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.passed == False


def test_langeval_exact_match_case_sensitive_false():
    entry = ExactMatchEntry(
        output="Hello World",
        expected_output="hello world",
    )
    settings = ExactMatchSettings(case_sensitive=False)

    evaluator = ExactMatchEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.passed == True


def test_langeval_exact_match_trim_whitespace_true():
    entry = ExactMatchEntry(
        output="  Hello World  ",
        expected_output="Hello World",
    )
    settings = ExactMatchSettings(trim_whitespace=True)

    evaluator = ExactMatchEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.passed == True


def test_langeval_exact_match_trim_whitespace_false():
    entry = ExactMatchEntry(
        output="  Hello World  ",
        expected_output="Hello World",
    )
    settings = ExactMatchSettings(trim_whitespace=False)

    evaluator = ExactMatchEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.passed == False


def test_langeval_exact_match_remove_punctuation_true():
    entry = ExactMatchEntry(
        output="Hello, World!",
        expected_output="Hello World",
    )
    settings = ExactMatchSettings(remove_punctuation=True)

    evaluator = ExactMatchEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.passed == True


def test_langeval_exact_match_remove_punctuation_false():
    entry = ExactMatchEntry(
        output="Hello, World!",
        expected_output="Hello World",
    )
    settings = ExactMatchSettings(remove_punctuation=False)

    evaluator = ExactMatchEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.passed == False


def test_langeval_exact_match_combined_settings():
    entry = ExactMatchEntry(
        output="  Hello, World!  ",
        expected_output="hello world",
    )
    settings = ExactMatchSettings(
        case_sensitive=False, trim_whitespace=True, remove_punctuation=True
    )

    evaluator = ExactMatchEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.passed == True


def test_langeval_exact_match_numbers_not_match():
    entry = ExactMatchEntry(
        output="-1",
        expected_output="1",
    )
    settings = ExactMatchSettings()
    evaluator = ExactMatchEvaluator(settings=settings)
    result = evaluator.evaluate(entry)
    assert result.passed == False
