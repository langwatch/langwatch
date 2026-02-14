from itertools import product
from langevals_core.base_evaluator import EvaluatorEntry
from langevals_langevals.llm_boolean import (
    CustomLLMBooleanEntry,
    CustomLLMBooleanEvaluator,
    CustomLLMBooleanSettings,
)
from langevals_lingua.language_detection import (
    LinguaLanguageDetectionEvaluator,
    LinguaLanguageDetectionSettings,
)
from langevals_ragas.answer_relevancy import RagasAnswerRelevancyEvaluator
import pytest
import pandas as pd

import litellm
from litellm.files.main import ModelResponse

from langevals import expect


entries = pd.DataFrame(
    {
        "input": [
            "What's the connection between 'breaking the ice' and the Titanic's first voyage?",
            "Comment la bataille de Verdun a-t-elle influencé la cuisine française?",
            "¿Puede el musgo participar en la purificación del aire en espacios cerrados?",
        ],
    }
)


@pytest.mark.parametrize("entry", entries.itertuples())
@pytest.mark.flaky(max_runs=3)
@pytest.mark.pass_rate(0.8)
def test_language_and_relevancy(entry):
    response: ModelResponse = litellm.completion(
        model="gpt-5",
        messages=[
            {
                "role": "system",
                "content": "You reply questions only in english, no matter tha language the question was asked",
            },
            {"role": "user", "content": entry.input},
        ],
        temperature=1.0,
    )  # type: ignore
    recipe = response.choices[0].message.content  # type: ignore

    language_checker = LinguaLanguageDetectionEvaluator(
        settings=LinguaLanguageDetectionSettings(
            check_for="output_matches_language",
            expected_language="EN",
        )
    )
    answer_relevancy_checker = RagasAnswerRelevancyEvaluator()

    expect(input=entry.input, output=recipe).to_pass(language_checker)
    expect(input=entry.input, output=recipe).score(
        answer_relevancy_checker
    ).to_be_greater_than(0.8)
