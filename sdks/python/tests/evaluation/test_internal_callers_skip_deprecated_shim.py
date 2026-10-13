"""The SDK's own callers reach langwatch.evaluation directly, never the deprecated langwatch.evaluations shim."""

import warnings
from unittest.mock import patch

import langwatch.guardrails as guardrails
from langwatch.evaluation import BasicEvaluateData, _merge_keyword_data


def test_merge_keyword_data_folds_fields_and_skips_none():
    data = {"input": "a"}
    merged = _merge_keyword_data(data, output="b", contexts=None, conversation=[])

    assert merged == {"input": "a", "output": "b", "conversation": []}
    assert data == {"input": "a"}


def test_merge_keyword_data_accepts_the_basic_model():
    merged = _merge_keyword_data(BasicEvaluateData(input="a"), expected_output="c")

    assert merged == {"input": "a", "expected_output": "c"}


@patch("langwatch.evaluation.evaluate")
def test_guardrail_evaluate_raises_no_deprecation_warning(evaluate):
    with warnings.catch_warnings():
        warnings.simplefilter("error", DeprecationWarning)
        guardrails.evaluate("presidio/pii_detection", input="hi", output="there")

    evaluate.assert_called_once_with(
        slug="presidio/pii_detection",
        data={"input": "hi", "output": "there", "contexts": [], "conversation": []},
        settings=None,
        as_guardrail=True,
    )
