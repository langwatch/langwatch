from typing import Type, Union
from langwatch_nlp.studio.dspy.retrieve import ColBERTv2RM, WeaviateRMWithConnection
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

from langwatch_nlp.studio.types.dsl import FieldType

EVALUATORS: dict[str, Type[dspy.Module]] = {
    "ExactMatchEvaluator": ExactMatchEvaluator,
    "AnswerCorrectnessEvaluator": AnswerCorrectnessEvaluator,
    "LangWatchEvaluator": LangWatchEvaluator,
}

EVALUATORS_FOR_TEMPLATE = {
    "ExactMatchEvaluator": {
        "import": "from langwatch_nlp.studio.modules.evaluators.exact_match import ExactMatchEvaluator",
        "class": "ExactMatchEvaluator",
    },
    "AnswerCorrectnessEvaluator": {
        "import": "from langwatch_nlp.studio.modules.evaluators.answer_correctness import AnswerCorrectnessEvaluator",
        "class": "AnswerCorrectnessEvaluator",
    },
    "LangWatchEvaluator": {
        "import": "from langwatch_nlp.studio.modules.evaluators.langwatch import LangWatchEvaluator",
        "class": "LangWatchEvaluator",
    },
}

PromptingTechniqueTypes = Union[Type[dspy.ChainOfThought], Type[dspy.ReAct]]

PROMPTING_TECHNIQUES: dict[str, PromptingTechniqueTypes] = {
    "ChainOfThought": dspy.ChainOfThought,
}

PROMPTING_TECHNIQUES_FOR_TEMPLATE: dict[str, dict[str, str]] = {
    "ChainOfThought": {
        "import": "import dspy",
        "class": "dspy.ChainOfThought",
    },
}

RETRIEVERS: dict[str, Type[dspy.Retrieve]] = {
    "ColBERTv2": ColBERTv2RM,
    "WeaviateRM": WeaviateRMWithConnection,
}

RETRIEVERS_FOR_TEMPLATE: dict[str, dict[str, str]] = {
    "ColBERTv2": {
        "import": "from langwatch_nlp.studio.dspy.retrieve import ColBERTv2RM",
        "class": "ColBERTv2RM",
    },
    "WeaviateRM": {
        "import": "from langwatch_nlp.studio.dspy.retrieve import WeaviateRMWithConnection",
        "class": "WeaviateRMWithConnection",
    },
}

OPTIMIZERS: dict[
    str,
    Union[Type[MIPROv2], Type[BootstrapFewShotWithRandomSearch]],
] = {
    "MIPROv2ZeroShot": MIPROv2,
    "MIPROv2": MIPROv2,
    "BootstrapFewShotWithRandomSearch": BootstrapFewShotWithRandomSearch,
}

FIELD_TYPE_TO_DSPY_TYPE = {
    FieldType.image: "dspy.Image",
    FieldType.str: "str",
    FieldType.int: "int",
    FieldType.float: "float",
    FieldType.bool: "bool",
    FieldType.list_str: "list[str]",
}