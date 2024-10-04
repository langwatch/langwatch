from typing import Type, Union
from langwatch_nlp.studio.modules.evaluators.exact_match import ExactMatchEvaluator
from dspy.teleprompt import (
    BootstrapFewShot,
    BootstrapFewShotWithRandomSearch,
    MIPROv2,
)


MODULES = {
    "evaluator": {
        "ExactMatchEvaluator": ExactMatchEvaluator,
    }
}

OPTIMIZERS: dict[
    str,
    Union[
        Type[MIPROv2], Type[BootstrapFewShot], Type[BootstrapFewShotWithRandomSearch]
    ],
] = {
    "MIPROv2ZeroShot": MIPROv2,
    "BootstrapFewShot": BootstrapFewShot,
    "BootstrapFewShotWithRandomSearch": BootstrapFewShotWithRandomSearch,
}
