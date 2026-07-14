import pytest

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


# @scenario "Boolean values match their numeric and string equivalents"
@pytest.mark.parametrize(
    "output,expected",
    [
        ("true", "1"),
        ("1", "true"),
        ("true", "true"),
        ("false", "0"),
        ("0", "false"),
        ("false", "false"),
        ("1.0", "1"),
        ("1", "1.0"),
    ],
)
def test_langeval_exact_match_js_loose_equality_match(output, expected):
    evaluator = ExactMatchEvaluator(settings=ExactMatchSettings())
    result = evaluator.evaluate(ExactMatchEntry(output=output, expected_output=expected))
    assert result.passed is True, f"expected {output!r} == {expected!r} under loose semantics"


# @scenario "Mismatched values do not falsely match"
@pytest.mark.parametrize(
    "output,expected",
    [
        ("true", "0"),
        ("false", "1"),
        ("2", "true"),
        ("hello", "true"),
        ("true", "hello"),
    ],
)
def test_langeval_exact_match_js_loose_equality_mismatch(output, expected):
    evaluator = ExactMatchEvaluator(settings=ExactMatchSettings())
    result = evaluator.evaluate(ExactMatchEntry(output=output, expected_output=expected))
    assert result.passed is False, f"expected {output!r} != {expected!r} under loose semantics"


# @scenario "Non-numeric, non-boolean strings still use the existing transform chain"
def test_langeval_exact_match_transform_chain_still_applies_for_text():
    """JS-loose layer must not short-circuit the existing trim/punct/case chain
    when both sides are free-form text."""
    entry = ExactMatchEntry(
        output="  Hello!  ",
        expected_output="hello",
    )
    settings = ExactMatchSettings(
        case_sensitive=False, trim_whitespace=True, remove_punctuation=True
    )
    evaluator = ExactMatchEvaluator(settings=settings)
    result = evaluator.evaluate(entry)
    assert result.passed


# @scenario "The float-equality short-circuit still applies for numeric strings"
def test_langeval_exact_match_float_short_circuit_still_applies():
    entry = ExactMatchEntry(output="1.50", expected_output="1.5")
    evaluator = ExactMatchEvaluator(settings=ExactMatchSettings())
    result = evaluator.evaluate(entry)
    assert result.passed
