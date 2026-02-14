import os

from langevals_langevals.llm_boolean import (
    CustomLLMBooleanEvaluator,
    CustomLLMBooleanSettings,
)
import pytest
import pandas as pd

import litellm
from litellm import ModelResponse

from langevals import expect

pytestmark = pytest.mark.skipif(
    not os.environ.get("OPENAI_API_KEY"), reason="OPENAI_API_KEY not set"
)

entries = pd.DataFrame(
    {
        "input": [
            "Generate me a recipe for a quick breakfast with bacon",
            "Generate me a recipe for a lunch using lentils",
            "Generate me a recipe for a vegetarian dessert",
        ],
    }
)


@pytest.mark.parametrize("entry", entries.itertuples())
@pytest.mark.pass_rate(0.5)
def test_llm_as_judge(entry):
    response: ModelResponse = litellm.completion(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "You are a tweet-size recipe generator, just recipe name and ingredients, no yapping.",
            },
            {"role": "user", "content": entry.input},
        ],
        temperature=0.0,
    )  # type: ignore
    recipe = response.choices[0].message.content  # type: ignore

    vegetarian_checker = CustomLLMBooleanEvaluator(
        settings=CustomLLMBooleanSettings(
            prompt="Is the recipe vegetarian?",
        )
    )

    expect(input=entry.input, output=recipe).to_pass(vegetarian_checker)


@pytest.mark.skipif(
    not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"),
    reason="Vertex AI credentials not set",
)
def test_llm_as_judge_vertex_ai():
    vegetarian_checker = CustomLLMBooleanEvaluator(
        settings=CustomLLMBooleanSettings(
            model="vertex_ai/gemini-1.5-flash",
            prompt="Is the recipe vegetarian?",
        )
    )

    expect(input="Vegetables", output="Broccoli").to_pass(vegetarian_checker)
