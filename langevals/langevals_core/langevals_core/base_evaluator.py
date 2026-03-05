from dataclasses import dataclass
import os
from abc import ABC
import traceback
from typing import (
    Callable,
    ClassVar,
    Generic,
    List,
    Literal,
    Optional,
    TypeVar,
    Union,
    get_type_hints,
)

from pydantic import BaseModel, ConfigDict, Field
from tenacity import Retrying, stop_after_attempt, wait_random_exponential
from tqdm.auto import tqdm as tqdm_auto
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from langevals_core.litellm_patch import patch_litellm

import time
import warnings
from tqdm import tqdm

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from tqdm.notebook import tqdm as tqdm_notebook
from functools import partialmethod

patch_litellm()

EvalCategories = Literal[
    "quality", "rag", "safety", "policy", "other", "custom", "similarity"
]


class EvaluatorSettings(BaseModel):
    pass


TSettings = TypeVar("TSettings", bound=EvaluatorSettings)

DEFAULT_MAX_TOKENS = 128_000
MAX_TOKENS_HARD_LIMIT = 1_048_576


class LLMEvaluatorSettings(EvaluatorSettings):
    model: str = Field(
        default="openai/gpt-5",
        description="The model to use for evaluation",
    )
    max_tokens: int = Field(
        default=DEFAULT_MAX_TOKENS,
        description="Max tokens allowed for evaluation",
    )


class ConversationEntry(BaseModel):
    input: str = Field(default="")
    output: str = Field(default="")


class EvaluatorEntry(BaseModel):
    """
    Entry datapoint for an evaluator, it should contain all the necessary information for the evaluator to run.

    Available fields are:

    input: The user or LLM input given to the model
    output: The LLM generated output
    contexts: A list of strings of the contexts that were considered when generating the LLM response
    expected_output: The ground truth of what the LLM should have generated, for comparison with the actual generated output
    """

    model_config = ConfigDict(extra="ignore")

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)  # Always call super()!

        required_fields_types = {
            "conversation": [ConversationEntry, Optional[ConversationEntry]],
            "input": [str, Optional[str]],
            "output": [str, Optional[str]],
            "contexts": [
                List[str],
                list[str],
                Optional[List[str]],
                Optional[list[str]],
            ],
            "expected_output": [str, Optional[str]],
            "expected_contexts": [
                List[str],
                list[str],
                Optional[List[str]],
                Optional[list[str]],
            ],
        }

        subclass_fields_types = get_type_hints(cls)

        extra_fields = subclass_fields_types.keys() - required_fields_types.keys()
        if extra_fields:
            raise TypeError(
                f"Extra fields not allowed in {cls.__name__}: {extra_fields}, only {list(required_fields_types.keys())} are allowed. This is meant to keep a standard interface accross all evaluators, other settings should go into the evaluator TSettings type instead."
            )

        for field, expected_types in required_fields_types.items():
            if (
                field in subclass_fields_types
                and subclass_fields_types[field] not in expected_types
                and field != "conversation"
            ):
                raise TypeError(
                    f"Field '{field}' in {cls.__name__} must be of type {expected_types}, got {subclass_fields_types[field].__name__}"
                )


TEntry = TypeVar("TEntry", bound=EvaluatorEntry)


class Money(BaseModel):
    currency: str
    amount: float


class EvaluationResult(BaseModel):
    """
    Evaluation result for a single entry that was successfully processed.
    Score represents different things depending on the evaluator, it can be a percentage, a probability, a distance, etc.
    Passed is a boolean that represents if the entry passed the evaluation or not, it can be None if the evaluator does not have a concept of passing or failing.
    Details is an optional string that can be used to provide additional information about the evaluation result.
    """

    status: Literal["processed"] = "processed"
    score: Optional[float] = None
    passed: Optional[bool] = None
    label: Optional[str] = None
    details: Optional[str] = Field(
        default=None, description="Short human-readable description of the result"
    )
    cost: Optional[Money] = None


class EvaluationResultSkipped(BaseModel):
    """
    Evaluation result marking an entry that was skipped with an optional details explanation.
    """

    status: Literal["skipped"] = "skipped"
    details: Optional[str] = None


class EvaluationResultError(BaseModel):
    """
    Evaluation result marking an entry that failed to be processed due to an error.
    """

    status: Literal["error"] = "error"
    error_type: str = Field(description="The type of the exception")
    details: str = Field(description="Error message")
    traceback: List[str] = Field(description="Traceback information for debugging")


TResult = TypeVar("TResult", bound=EvaluationResult)

SingleEvaluationResult = Union[
    EvaluationResult, EvaluationResultSkipped, EvaluationResultError
]

BatchEvaluationResult = List[SingleEvaluationResult]


@dataclass
class EnvMissingException(Exception):
    message: str


models_providers_env_vars = {
    "openai": ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
    "azure": [
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_ENDPOINT",
        "AZURE_DEPLOYMENT_NAME",
        "AZURE_EMBEDDINGS_DEPLOYMENT_NAME",
        # litellm
        "AZURE_API_KEY",
        "AZURE_API_BASE",
    ],
    "groq": ["GROQ_API_KEY"],
    "anthropic": ["ANTHROPIC_API_KEY"],
    "vertex_ai": ["GOOGLE_APPLICATION_CREDENTIALS"],
}

models_env_vars = [env for envs in models_providers_env_vars.values() for env in envs]


class BaseEvaluator(BaseModel, Generic[TEntry, TSettings, TResult], ABC):
    default_settings: ClassVar[TSettings]  # type: ignore
    settings: TSettings = Field(default=None)
    env: Optional[dict[str, str]] = None
    entry: Optional[TEntry] = (
        None  # dummy field just to read the type later when creating the routes
    )
    result: Optional[TResult] = (
        None  # dummy field just to read the type later when creating the route
    )

    name: ClassVar[str]
    category: ClassVar[EvalCategories]
    env_vars: ClassVar[list[str]] = []
    docs_url: ClassVar[str] = ""
    is_guardrail: ClassVar[bool] = False
    __preloaded: ClassVar[bool] = False

    def __init__(self, **kwargs):
        if "settings" not in kwargs:
            kwargs["settings"] = self.default_settings
        super().__init__(**kwargs)
        if not self.__preloaded:
            self.__class__.preload()
        self.set_model_envs()

    @classmethod
    def preload(cls):
        cls.__preloaded = True

    def get_env(self, var: str):
        if (
            var not in self.env_vars
            and var not in models_env_vars
            and (self.env is None or var not in self.env)
        ):
            raise ValueError(
                f"Variable {var} not defined in evaluator env_vars, cannot access it."
            )

        try:
            return (
                self.env[var]
                if self.env is not None and var in self.env
                else os.environ[var]
            )

        except KeyError:
            raise EnvMissingException(f"Variable {var} not defined in environment.")

    def set_model_envs(self):
        # Those variables may be used non-explicitly, so we need to set them globally here for the arguments given
        for key, value in (self.env or {}).items():
            if key in models_env_vars or key.startswith("X_LITELLM_"):
                os.environ[key] = value

        # azure alias for litellm
        if os.environ.get("AZURE_OPENAI_API_KEY") is not None:
            os.environ["AZURE_API_KEY"] = os.environ["AZURE_OPENAI_API_KEY"]
        if os.environ.get("AZURE_OPENAI_ENDPOINT") is not None:
            os.environ["AZURE_API_BASE"] = os.environ["AZURE_OPENAI_ENDPOINT"]
        # reverse azure alias for litellm
        if os.environ.get("AZURE_API_KEY") is not None:
            os.environ["AZURE_OPENAI_API_KEY"] = os.environ["AZURE_API_KEY"]
        if os.environ.get("AZURE_API_BASE") is not None:
            os.environ["AZURE_OPENAI_ENDPOINT"] = os.environ["AZURE_API_BASE"]

    def evaluate(self, entry: TEntry) -> SingleEvaluationResult:
        raise NotImplementedError("This method should be implemented by subclasses.")

    def _evaluate_entry(self, entry, retries=0, restore_tqdm=True):
        _disable_tqdm()
        try:
            retryer = Retrying(
                stop=stop_after_attempt(retries),
                wait=wait_random_exponential(multiplier=1, min=4, max=10),
                reraise=True,
            )
            return retryer(self.evaluate, entry)
        except Exception as exception:
            return EvaluationResultError(
                error_type=type(exception).__name__,
                details=str(exception),
                traceback=list(
                    traceback.TracebackException.from_exception(exception).format()
                ),
            )
        finally:
            if restore_tqdm:
                _restore_tqdm()

    def evaluate_batch(
        self,
        data: List[TEntry],
        index=0,
        max_evaluations_in_parallel=50,
        retries=3,
        _executor_ref: Optional[Callable[[ThreadPoolExecutor], None]] = None,
    ) -> BatchEvaluationResult:
        _restore_tqdm()
        results: list[SingleEvaluationResult] = [
            EvaluationResultSkipped(details="not processed")
        ] * len(data)
        with ThreadPoolExecutor(max_workers=max_evaluations_in_parallel) as executor:
            future_to_index = {
                executor.submit(
                    self._evaluate_entry, entry, retries, restore_tqdm=False
                ): idx
                for idx, entry in enumerate(data)
            }

            if _executor_ref is not None:
                _executor_ref(executor)

            not_done = list(future_to_index.keys())
            with tqdm_auto(total=len(future_to_index), position=index) as progress:
                try:
                    while not_done:
                        if hasattr(
                            executor, "interrupted"
                        ) and executor.__getattribute__("interrupted"):
                            raise KeyboardInterrupt()
                        done, not_done = wait(
                            not_done, timeout=0.1, return_when=FIRST_COMPLETED
                        )
                        for future in done:
                            idx = future_to_index[future]
                            results[idx] = future.result()
                            progress.update(1)
                except KeyboardInterrupt:
                    executor.shutdown(wait=False, cancel_futures=True)
                    raise

        _restore_tqdm()
        return results


_original_tqdm_init = tqdm.__init__
_original_tqdm_notebook_init = tqdm_notebook.__init__
_tqdm_disabled_once = False


# Hack to disable tqdm output from Ragas and other libraries and use the one from langevals instead
def _disable_tqdm():
    global _tqdm_disabled_once
    if not _tqdm_disabled_once:
        time.sleep(0.1)
        _tqdm_disabled_once = True
    tqdm.__init__ = partialmethod(tqdm.__init__, disable=True)  # type: ignore
    tqdm_notebook.__init__ = partialmethod(tqdm_notebook.__init__, disable=True)  # type: ignore


def _restore_tqdm():
    global _tqdm_disabled_once
    _tqdm_disabled_once = False

    tqdm.__init__ = _original_tqdm_init
    tqdm_notebook.__init__ = _original_tqdm_notebook_init
