from typing import Type, Union
from langwatch_nlp.studio.modules.evaluators.exact_match import ExactMatchEvaluator
from dspy.teleprompt import (
    Teleprompter,
    BootstrapFewShot,
    BootstrapFewShotWithRandomSearch,
)


MODULES = {
    "evaluator": {
        "ExactMatchEvaluator": ExactMatchEvaluator,
    }
}

OPTIMIZERS: dict[
    str, Union[Type[BootstrapFewShot], Type[BootstrapFewShotWithRandomSearch]]
] = {
    "BootstrapFewShot": BootstrapFewShot,
    "BootstrapFewShotWithRandomSearch": BootstrapFewShotWithRandomSearch,
}
