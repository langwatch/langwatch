from typing import Type, Union
from langwatch_nlp.studio.dspy.retrieve import ColBERTv2RM
from langwatch_nlp.studio.modules.evaluators.answer_correctness import (
    AnswerCorrectnessEvaluator,
)
from langwatch_nlp.studio.modules.evaluators.exact_match import ExactMatchEvaluator
from langwatch_nlp.studio.modules.evaluators.langwatch import LangWatchEvaluator
from dspy.teleprompt import (
    BootstrapFewShot,
    BootstrapFewShotWithRandomSearch,
    MIPROv2,
)

import dspy
from dspy.retrieve.weaviate_rm import WeaviateRM

EVALUATORS: dict[str, Type[dspy.Module]] = {
    "ExactMatchEvaluator": ExactMatchEvaluator,
    "AnswerCorrectnessEvaluator": AnswerCorrectnessEvaluator,
    "LangWatchEvaluator": LangWatchEvaluator,
}


PromptingTechniqueTypes = Union[Type[dspy.ChainOfThought], Type[dspy.ReAct]]

PROMPTING_TECHNIQUES: dict[str, PromptingTechniqueTypes] = {
    "ChainOfThought": dspy.ChainOfThought,
}

RETRIEVERS: dict[str, Type[dspy.Retrieve]] = {
    "ColBERTv2": ColBERTv2RM,
    "WeaviateRM": WeaviateRM,
}

OPTIMIZERS: dict[
    str,
    Union[Type[MIPROv2], Type[BootstrapFewShotWithRandomSearch]],
] = {
    "MIPROv2ZeroShot": MIPROv2,
    "MIPROv2": MIPROv2,
    "BootstrapFewShotWithRandomSearch": BootstrapFewShotWithRandomSearch,
}
