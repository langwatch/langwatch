from langevals_langevals.competitor_blocklist import (
    CompetitorBlocklistEvaluator,
    CompetitorBlocklistResult,
    CompetitorBlocklistSettings,
)
import langevals
import pandas as pd

from langevals.evaluation import EvaluationResultSet, _pandas_to_generic_entries


def test_run_simple_evaluation():
    # TODO: validate the dataframe structure when running the evaluation
    entries = pd.DataFrame(
        {
            "input": ["hello", "how are you?", "what is your name?"],
            "output": ["hi", "I am a chatbot, no feelings", "My name is Bob"],
        }
    )

    results = langevals.evaluate(
        entries,
        [
            CompetitorBlocklistEvaluator(
                settings=CompetitorBlocklistSettings(competitors=["Bob"])
            ),
        ],
    )

    assert results.results == [
        [
            CompetitorBlocklistResult(score=0, passed=True),
            CompetitorBlocklistResult(score=0, passed=True),
            CompetitorBlocklistResult(
                score=1, passed=False, details="Competitors mentioned: Bob"
            ),
        ],
    ]

    assert results.to_list() == {
        "competitor_blocklist": [
            {
                "status": "processed",
                "score": 0.0,
                "passed": True,
                "details": None,
                "cost": None,
            },
            {
                "status": "processed",
                "score": 0.0,
                "passed": True,
                "details": None,
                "cost": None,
            },
            {
                "status": "processed",
                "score": 1.0,
                "passed": False,
                "details": "Competitors mentioned: Bob",
                "cost": None,
            },
        ],
    }

    assert (
        results.to_pandas().to_dict()
        == pd.DataFrame(
            {
                "input": ["hello", "how are you?", "what is your name?"],
                "output": ["hi", "I am a chatbot, no feelings", "My name is Bob"],
                "competitor_blocklist_score": [0.0, 0.0, 1.0],
                "competitor_blocklist_passed": [True, True, False],
                "competitor_blocklist_details": [
                    None,
                    None,
                    "Competitors mentioned: Bob",
                ],
            }
        ).to_dict()
    )


# TODO: accept huggingface datasets as input as well (maybe find an example for the readme? load_dataset("explodinggradients/amnesty_qa", "english_v2"))
