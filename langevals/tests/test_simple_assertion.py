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

models = ["gpt-4o-mini", "gpt-5"]

client = instructor.from_litellm(completion)


# @pytest.mark.asyncio_cooperative  # Waiting for issue: https://github.com/willemt/pytest-asyncio-cooperative/issues/65
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
        temperature=1.0,
    )

    assert address.model_dump_json() == entry.expected_output
