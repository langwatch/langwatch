![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)
[![Discord](https://img.shields.io/badge/LangWatch-Discord-%235865F2.svg)](https://discord.gg/kT4PhDS2gH)
[![LangEvals Python version](https://img.shields.io/pypi/v/langevals?color=007EC6)](https://pypi.org/project/langevals/)

# LangEvals

LangEvals is the all-in-one library for LLM testing and evaluating in Python, it can be used in notebooks for exploration, in pytest for writting unit tests or as a server API for live-evaluations and guardrails. LangEvals is modular, including 20+ evaluators such as Ragas for RAG quality, OpenAI Moderation and Azure Jailbreak detection for safety and many others under the same interface.

LangEvals is the backend that powers [LangWatch](https://github.com/langwatch/langwatch) evaluations.

## Getting Started

To use LangEvals locally, install it as a dependency, together with the evaluators you are interested on:

```bash
pip install "langevals[all]"
# or select only the ones you are interested on, e.g.:
pip install "langevals[azure,ragas,lingua]"
```

Then right away you can start LangEvals as a server with:

```
langevals-server
```

And navigate to `http://localhost:5562/` to try out the evaluators.

Alternatively, you can use it as a library as the examples below show.

### Running Batch Evaluations on Notebooks

When exploring, it is usual to generate a number of outputs from your LLM, and then evaluate them all for performance score, for example on a Jupyter Notebook. You can use LangEvals `evaluate()` to score the results in batch using diverse evaluators:

```python
import langevals
from langevals_ragas.answer_relevancy import RagasAnswerRelevancyEvaluator
from langevals_langevals.competitor_blocklist import (
    CompetitorBlocklistEvaluator,
    CompetitorBlocklistSettings,
)
import pandas as pd

entries = pd.DataFrame(
    {
        "input": ["hello", "how are you?", "what is your name?"],
        "output": ["hi", "I am a chatbot, no feelings", "My name is Bob"],
    }
)

results = langevals.evaluate(
    entries,
    [
        RagasAnswerRelevancyEvaluator(),
        CompetitorBlocklistEvaluator(
            settings=CompetitorBlocklistSettings(competitors=["Bob"])
        ),
    ],
)

results.to_pandas()
```

Results:

| input              | output                      | answer_relevancy | competitor_blocklist | competitor_blocklist_details |
| ------------------ | --------------------------- | ---------------- | -------------------- | ---------------------------- |
| hello              | hi                          | 0.800714         | True                 | None                         |
| how are you?       | I am a chatbot, no feelings | 0.813168         | True                 | None                         |
| what is your name? | My name is Bob              | 0.971663         | False                | Competitors mentioned: Bob   |

### Unit Test Evaluations with PyTest

Using various pytest plugins together with LangEvals makes a powerful combination to be able to write unit tests for LLMs and prevent regressions. Due to the probabilistic nature of LLMs, some extra care is needed as you will see below.

#### Simple assertions - entity extraction test example

The first simple case is when LLMs are used where the expected output is fairly unambiguous, for example, extracting address entities from natural language text. In this example we use the [instructor library](https://github.com/jxnl/instructor), to use the LLM to easily extract values to a pydantic module, together with the [litellm](https://github.com/BerriAI/litellm) library, to call multiple LLM models:

```python

from itertools import product
import pytest
import pandas as pd

import instructor

from litellm import completion
from pydantic import BaseModel


class Address(BaseModel):
    number: int
    street_name: str
    city: str
    country: str


entries = pd.DataFrame(
    {
        "input": [
            "Please send the package to 123 Main St, Springfield.",
            "J'ai déménagé récemment à 56 Rue de l'Université, Paris.",
            "A reunião será na Avenida Paulista, 900, São Paulo.",
        ],
        "expected_output": [
            Address(
                number=123, street_name="Main St", city="Springfield", country="USA"
            ).model_dump_json(),
            Address(
                number=56,
                street_name="Rue de l'Université",
                city="Paris",
                country="France",
            ).model_dump_json(),
            Address(
                number=900,
                street_name="Avenida Paulista",
                city="São Paulo",
                country="Brazil",
            ).model_dump_json(),
        ],
    }
)

models = ["gpt-3.5-turbo", "gpt-4-turbo", "groq/llama3-70b-8192"]

client = instructor.from_litellm(completion)


@pytest.mark.parametrize("entry, model", product(entries.itertuples(), models))
@pytest.mark.flaky(max_runs=3)
@pytest.mark.pass_rate(0.6)
def test_extracts_the_right_address(entry, model):
    address = client.chat.completions.create(
        model=model,
        response_model=Address,
        messages=[
            {"role": "user", "content": entry.input},
        ],
        temperature=0.0,
    )

    assert address.model_dump_json() == entry.expected_output
```

In the example above, our test actually becomes 9 tests, checking for address extraction correctness in each of the 3 samples against 3 different models `gpt-3.5-turbo`, `gpt-4-turbo` and `groq/llama3`. This is done by the `@pytest.mark.parametrize` annotation and the `product` function to combine entries and models. The actual assertion is a simple `assert` with `==` comparison as you can see in the last line.

Appart from `parametrize`, we also use the [flaky](https://github.com/box/flaky) library for retries with `@pytest.mark.flaky(max_runs=3)`, this allows us to effectively do a 3-shot prompting with our LLM. If you wish, you can also ensure the majority of the attempts are correct by using `@pytest.mark.flaky(max_runs=3, min_passes=2)`.

Lastly, we use the `@pytest.mark.pass_rate` annotation provided by LangEvals, this allow the test to pass even if some samples fail, as they do for example when the model guesses "United States" instead of "USA" for the country field. Since LLMs are probabilistic, this is necessary for bringing more stability to your test suite, while still ensuring a minimum threshold of accuracy, which in our case is defined as `0.6` (60%).

#### Using LangEvals Evaluators - LLM-as-a-Judge

As things get more nuanced and less objective, exact string matches are no longer possible. We can then rely on LangEvals evaluators for validating many aspects of the LLM inputs and outputs. For complete flexibility, we can use for example a custom LLM-as-a-judge, with `CustomLLMBooleanEvaluator`. In the example below we validate that more than 80% of the recipes generated are vegetarian:

```python
from langevals import expect

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
@pytest.mark.flaky(max_runs=3)
@pytest.mark.pass_rate(0.8)
def test_extracts_the_right_address(entry):
    response: ModelResponse = litellm.completion(
        model="gpt-3.5-turbo",
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
```

This test fails with a nice explanation from the LLM judge:

```python
FAILED tests/test_llm_as_judge.py::test_llm_as_judge[entry0] - AssertionError: Custom LLM Boolean Evaluator to_pass FAILED - The recipe for a quick breakfast with bacon includes bacon strips, making it a non-vegetarian recipe.
```

Notice we use the `expect` assertion util, this helps making it easier to run the evaluation and print a nice output with the detailed explanation in case of failures. The `expect` utility interface is modeled after Jest assertions, so you can expect a somewhat similar API if you are expericed with Jest.

#### Using LangEvals Evaluators - Out of the box evaluators

Just like `CustomLLMBooleanEvaluator`, you can use any other evaluator available from LangEvals to prevent regression on a variety of cases, for example, here we check that the LLM answers are always in english, regardless of the language used in the question, we also measure how relevant the answers are to the question:

```python
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
        model="gpt-3.5-turbo",
        messages=[
            {
                "role": "system",
                "content": "You reply questions only in english, no matter tha language the question was asked",
            },
            {"role": "user", "content": entry.input},
        ],
        temperature=0.0,
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
```

In this example we are now not only validating a boolean assertion, but also making sure that 80% of our samples keep an answer relevancy score above 0.8 from the Ragas Answer Relevancy Evaluator.

# Contributing

LangEvals is a monorepo and has many subpackages with different dependencies for each evaluator library or provider. We use poetry to install all dependencies and create a virtual env for each sub-package to make sure they are fully isolated. Given this complexity, to make it easier to contribute to LangEvals we recommend using VS Code for the development. Before opening up on VS Code though, you need to make sure to install all dependencies, generating thus the .venv for each package:

```
make install
```

This will also generate the `langevals.code-workspace` file, creating a different workspace per evaluator and telling VS Code which venv to use for each. Then, open this file on vscode and click the "Open Workspace" button

## Adding New Evaluators

To add a completely new evaluator for a library or API that is not already implemented, create a new folder in `evaluators/` following the structure of existing evaluator packages. You'll need to:

1. Create a new package directory (e.g., `evaluators/your_library/`)
2. Implement your evaluator by extending `BaseEvaluator` from `langevals_core.base_evaluator`
3. Add the necessary dependencies to `pyproject.toml`
4. Create corresponding tests following the testing patterns used in other evaluator packages

You can reference existing evaluators like `langevals/langevals_langevals/basic.py` or `azure/langevals_azure/content_safety.py` as examples of the structure and patterns to follow.

If you want to add a new evaluator to an existing evaluator package (say, if OpenAI launches a new API for example), simply create a new Python file next to the existing ones in that package.

To test it all together, run:

```
make lock
make install
make test
```
