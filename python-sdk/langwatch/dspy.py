from contextlib import contextmanager
import random
import re
import time
import warnings
import dspy
from typing import Callable, List, Optional, Any, Type, Union
from typing_extensions import TypedDict
import langwatch
import httpx
import json
from pydantic import BaseModel
from dspy.predict import Predict
from dspy.teleprompt import (
    Teleprompter,
    BootstrapFewShot,
    BootstrapFewShotWithRandomSearch,
    COPRO,
    MIPRO,
    MIPROv2,
)
from dspy.signatures.signature import SignatureMeta
from dspy.primitives.prediction import Prediction, Completions
from dspy.primitives.example import Example
from pydantic.fields import FieldInfo
from coolname import generate_slug
from retry import retry
from dspy.evaluate.evaluate import Evaluate

from langwatch.tracer import ContextTrace


class SerializableAndPydanticEncoder(json.JSONEncoder):
    def default(self, o):
        classname = f"{o.__class__.__module__}.{o.__class__.__name__}"
        if isinstance(o, BaseModel):
            return o.model_dump()
        if isinstance(o, FieldInfo):
            return o.__repr__()
        if isinstance(o, set):
            return list(o)
        if isinstance(o, Predict):
            return {"__class__": classname} | o.__dict__
        if isinstance(o, Example):
            return {"__class__": classname} | o.__dict__
        if isinstance(o, SignatureMeta):
            return {"__class__": classname} | {
                "signature": o.signature,
                "instructions": o.instructions,
                "fields": o.fields,
            }
        if isinstance(o, Prediction):
            return {"__class__": classname} | o.__dict__
        if isinstance(o, Completions):
            return {"__class__": classname} | o.__dict__
        return super().default(o)


class DSPyLLMCall(TypedDict):
    __class__: str
    response: Any


class Timestamps(BaseModel):
    created_at: int


class DSPyTrace(BaseModel):
    input: Any
    pred: Any


class DSPyExample(BaseModel):
    example: Any
    pred: Any
    score: float
    trace: Optional[List[DSPyTrace]]


class DSPyPredictor(BaseModel):
    name: str
    predictor: Any


class DSPyOptimizer(BaseModel):
    name: str
    parameters: Any


class DSPyStep(BaseModel):
    run_id: str
    experiment_slug: str
    index: str
    score: float
    label: str
    optimizer: DSPyOptimizer
    predictors: List[DSPyPredictor]
    examples: List[DSPyExample]
    llm_calls: List[DSPyLLMCall]
    timestamps: Timestamps


class LangWatchDSPy:
    """LangWatch DSPy visualization tracker"""

    _instance: Optional["LangWatchDSPy"] = None
    experiment_slug: Optional[str] = None
    experiment_path: str = ""
    run_id: Optional[str] = None

    examples_buffer: List[DSPyExample] = []
    llm_calls_buffer: List[DSPyLLMCall] = []
    steps_buffer: List[DSPyStep] = []

    def __new__(cls):
        """
        Singleton Pattern. See https://python-patterns.guide/gang-of-four/singleton/
        """

        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def init(self, experiment: str, optimizer: Optional[Teleprompter]):
        if langwatch.api_key is None:
            print("API key was not detected, calling langwatch.login()...")
            langwatch.login()
            return

        try:
            response = httpx.post(
                f"{langwatch.endpoint}/api/experiment/init",
                headers={"X-Auth-Token": langwatch.api_key or ""},
                json={"experiment_slug": experiment, "experiment_type": "DSPY"},
            )
        except Exception as e:
            raise Exception(f"Error initializing LangWatch experiment: {e}")
        if response.status_code == 401:
            langwatch.api_key = None
            raise ValueError(
                "API key is not valid, please try to login again with langwatch.login()"
            )
        response.raise_for_status()

        self.experiment_slug = experiment
        random.seed()  # MIPRO meses up the global seed, so we need to reset it to random to get a new run_id
        self.run_id = generate_slug(3)
        self.reset()

        self.patch_llms()
        if optimizer is not None:
            self.patch_optimizer(optimizer)
        else:
            print(
                "No optimizer provided, assuming custom optimizer tracking, make sure to call `track_metric` and `log_step` manually: https://docs.langwatch.ai/dspy-visualization/custom-optimizer"
            )

        result = response.json()
        self.experiment_path = result["path"]
        print(f"\n[LangWatch] Experiment initialized, run_id: {self.run_id}")
        print(
            f"[LangWatch] Open {langwatch.endpoint}{self.experiment_path}?runIds={self.run_id} to track your DSPy training session live\n"
        )

    def patch_optimizer(self, optimizer: Teleprompter):
        METRIC_TRACKING_CLASSMAP = {
            BootstrapFewShot: LangWatchTrackedBootstrapFewShot,
            BootstrapFewShotWithRandomSearch: LangWatchTrackedBootstrapFewShotWithRandomSearch,
            COPRO: LangWatchTrackedCOPRO,
            MIPRO: LangWatchTrackedMIPRO,
            MIPROv2: LangWatchTrackedMIPROv2,
        }

        if optimizer.__class__ in METRIC_TRACKING_CLASSMAP:
            optimizer.__class__ = METRIC_TRACKING_CLASSMAP[optimizer.__class__]
            optimizer.patch()  # type: ignore
        else:
            supported = ", ".join(
                [f"{c.__name__}" for c in METRIC_TRACKING_CLASSMAP.keys()]
            )
            raise ValueError(
                f"Optimizer {optimizer.__class__.__name__} is not supported by LangWatch DSPy visualizer yet, only [{supported}] are supported, please open an issue: https://github.com/langwatch/langwatch/issues"
            )

    def reset(self):
        self.examples_buffer = []
        self.llm_calls_buffer = []
        self.steps_buffer = []

    def patch_llms(self):
        if not hasattr(dspy.OpenAI, "_original_request"):
            dspy.OpenAI._original_request = dspy.OpenAI.request  # type: ignore

        this = self

        def patched_request(self, *args, **kwargs):
            classname = f"{self.__class__.__module__}.{self.__class__.__name__}"
            response = self._original_request(*args, **kwargs)
            this.llm_calls_buffer.append(
                DSPyLLMCall(__class__=classname, response=response)
            )
            return response

        dspy.OpenAI.request = patched_request

    def track_metric(
        self,
        metric_fn: Callable[
            [Example, Prediction, Optional[List[Any]]], Union[bool, float]
        ],
    ):
        def wrapped(example, pred, trace=None):
            score = metric_fn(example, pred, trace=trace)  # type: ignore

            self.examples_buffer.append(
                DSPyExample(
                    example=example._store,
                    pred=pred._store,
                    score=float(score),
                    trace=(
                        [DSPyTrace(input=t[1], pred=t[2]) for t in trace]
                        if trace
                        else None
                    ),
                )
            )

            return score

        return wrapped

    def log_step(
        self,
        *,
        optimizer: DSPyOptimizer,
        index: str,
        score: float,
        label: str,
        predictors: List[DSPyPredictor],
    ):
        step = DSPyStep(
            run_id=self.run_id or "unknown",
            experiment_slug=self.experiment_slug or "unknown",
            index=index,
            score=score,
            label=label,
            optimizer=optimizer,
            predictors=predictors,
            examples=self.examples_buffer,
            llm_calls=self.llm_calls_buffer,
            timestamps=Timestamps(created_at=int(time.time() * 1000)),
        )
        self.steps_buffer.append(step)
        self.examples_buffer = []
        self.llm_calls_buffer = []
        self.send_steps()

    @retry(tries=3, delay=0.5)
    def send_steps(self):
        response = httpx.post(
            f"{langwatch.endpoint}/api/dspy/log_steps",
            headers={
                "X-Auth-Token": langwatch.api_key or "",
                "Content-Type": "application/json",
            },
            data=json.dumps(self.steps_buffer, cls=SerializableAndPydanticEncoder),  # type: ignore
        )
        response.raise_for_status()
        self.steps_buffer = []

    def tracer(self, trace: ContextTrace):
        return DSPyTracer(trace=trace)


langwatch_dspy = LangWatchDSPy()


class LangWatchTrackedBootstrapFewShot(BootstrapFewShot):
    last_step: int = 0
    last_round_idx: int = 0

    def patch(self):
        self.metric = langwatch_dspy.track_metric(self.metric)

    def _bootstrap_one_example(self, example, round_idx=0):
        self.last_round_idx = round_idx
        if round_idx != self.last_step and round_idx < self.max_rounds:
            self._log_step(round_idx)
        return super()._bootstrap_one_example(example, round_idx=round_idx)

    def _train(self):
        result = super()._train()
        final_predictors = [
            DSPyPredictor(name=name, predictor=predictor)
            for name, predictor in self.student.named_predictors()
        ]
        self._log_step(round_idx=self.last_round_idx + 1, predictors=final_predictors)
        return result

    def _log_step(self, round_idx: int, predictors: List[DSPyPredictor] = []):
        self.last_step = round_idx

        bootstrapped_demos_count = sum(
            [len(demos) for demos in self.name2traces.values()]
        )

        if len(predictors) == 0:
            student_ = self.student.deepcopy()
            for name, predictor in student_.named_predictors():
                augmented_demos = self.name2traces[name][: self.max_bootstrapped_demos]
                predictor.demos = augmented_demos
                predictors.append(DSPyPredictor(name=name, predictor=predictor))

        langwatch_dspy.log_step(
            optimizer=DSPyOptimizer(
                name=BootstrapFewShot.__name__,
                parameters={
                    "max_bootstrapped_demos": self.max_bootstrapped_demos,
                    "max_labeled_demos": self.max_labeled_demos,
                    "max_rounds": self.max_rounds,
                    "max_errors": self.max_errors,
                    "metric_threshold": self.metric_threshold,
                },
            ),
            index=str(round_idx),
            score=bootstrapped_demos_count,
            label="bootstrapped demos",
            predictors=predictors,
        )


class LangWatchTrackedBootstrapFewShotWithRandomSearch(
    BootstrapFewShotWithRandomSearch
):
    def patch(self):
        self.metric = langwatch_dspy.track_metric(self.metric)

    def compile(self, student, **kwargs):
        with self._patch_evaluate():
            return super().compile(student, **kwargs)

    @contextmanager
    def _patch_evaluate(self):
        original_evaluate_call = Evaluate.__call__
        step = 1

        this = self

        def patched_evaluate_call(self, program: dspy.Module, *args, **kwargs):
            nonlocal step

            if "return_all_scores" not in kwargs or not kwargs["return_all_scores"]:
                raise ValueError(
                    "return_all_scores is not True for some reason, please report it at https://github.com/langwatch/langwatch/issues"
                )
            score, subscores = original_evaluate_call(self, program, *args, **kwargs)  # type: ignore

            langwatch_dspy.log_step(
                optimizer=DSPyOptimizer(
                    name=BootstrapFewShotWithRandomSearch.__name__,
                    parameters={
                        "max_num_samples": this.max_num_samples,
                        "max_labeled_demos": this.max_labeled_demos,
                        "max_rounds": this.max_rounds,
                        "num_candidate_sets": this.num_candidate_sets,
                        "num_threads": this.num_threads,
                        "max_errors": this.max_errors,
                        "stop_at_score": this.stop_at_score,
                        "metric_threshold": this.metric_threshold,
                    },
                ),
                index=str(step),
                score=score,
                label="score",
                predictors=[
                    DSPyPredictor(name=name, predictor=predictor)
                    for name, predictor in program.named_predictors()
                ],
            )

            step += 1

            return score, subscores

        Evaluate.__call__ = patched_evaluate_call

        try:
            yield
        finally:
            Evaluate.__call__ = original_evaluate_call


class LangWatchTrackedCOPRO(COPRO):
    def patch(self):
        self.metric = langwatch_dspy.track_metric(self.metric)

    def compile(self, student, **kwargs):
        with self._patch_logger_and_evaluate():
            return super().compile(student, **kwargs)

    @contextmanager
    def _patch_logger_and_evaluate(self):
        original_logger_info = dspy.logger.info
        original_evaluate_call = Evaluate.__call__
        step = None
        scores = []

        this = self

        def patched_logger_info(text, *args, **kwargs):
            nonlocal step, scores

            match = re.search(
                r"At Depth (\d+)/(\d+), Evaluating Prompt Candidate #(\d+)/(\d+) for Predictor (\d+) of (\d+)",
                text,
            )
            if match:
                depth, _, breadth, _, predictor, _ = match.groups()
                new_step = f"{depth}.{predictor}.{breadth}"
                if new_step != step:
                    step = new_step
                    scores = []
            return original_logger_info(text, *args, **kwargs)

        def patched_evaluate_call(self, program: dspy.Module, *args, **kwargs):
            nonlocal step
            if not step:
                raise ValueError(
                    "Step is not defined, please report it at https://github.com/langwatch/langwatch/issues"
                )

            step_ = step

            score: float = original_evaluate_call(self, program, *args, **kwargs)  # type: ignore

            scores.append(score)

            if max(scores) == score:
                langwatch_dspy.log_step(
                    optimizer=DSPyOptimizer(
                        name=COPRO.__name__,
                        parameters={
                            "breadth": this.breadth,
                            "depth": this.depth,
                            "init_temperature": this.init_temperature,
                        },
                    ),
                    index=step_,
                    score=score,
                    label="score",
                    predictors=[
                        DSPyPredictor(name=name, predictor=predictor)
                        for name, predictor in program.named_predictors()
                    ],
                )

            return score

        dspy.logger.info = patched_logger_info
        Evaluate.__call__ = patched_evaluate_call

        try:
            yield
        finally:
            dspy.logger.info = original_logger_info
            Evaluate.__call__ = original_evaluate_call


class LangWatchTrackedMIPRO(MIPRO):
    def patch(self):
        self.metric = langwatch_dspy.track_metric(self.metric)

    def compile(self, student, **kwargs):
        with self._patch_print_and_evaluate():
            return super().compile(student, **kwargs)

    @contextmanager
    def _patch_print_and_evaluate(self):
        original_evaluate_call = Evaluate.__call__
        step = 0
        substep = 0
        scores = []

        this = self

        last_candidate_program: Optional[int] = None

        def patched_evaluate_call(self, program: dspy.Module, *args, **kwargs):
            nonlocal step, scores, substep, last_candidate_program

            if last_candidate_program != id(program):
                step += 1
                substep = 0
                scores = []
                last_candidate_program = id(program)

            step_ = str(step) if substep == 0 else f"{step}.{substep}"
            substep += 1

            score: float = original_evaluate_call(self, program, *args, **kwargs)  # type: ignore

            scores.append(score)

            if max(scores) == score:
                langwatch_dspy.log_step(
                    optimizer=DSPyOptimizer(
                        name=MIPRO.__name__,
                        parameters={
                            "num_candidates": this.num_candidates,
                            "init_temperature": this.init_temperature,
                        },
                    ),
                    index=step_,
                    score=score,
                    label="score",
                    predictors=[
                        DSPyPredictor(name=name, predictor=predictor)
                        for name, predictor in program.named_predictors()
                    ],
                )

            return score

        Evaluate.__call__ = patched_evaluate_call

        try:
            yield
        finally:
            Evaluate.__call__ = original_evaluate_call


class LangWatchTrackedMIPROv2(MIPROv2):
    def patch(self):
        self.metric = langwatch_dspy.track_metric(self.metric)

    def compile(self, student, **kwargs):
        with self._patch_print_and_evaluate():
            return super().compile(student, **kwargs)

    @contextmanager
    def _patch_print_and_evaluate(self):
        original_evaluate_call = Evaluate.__call__
        step = 0
        substep = 0
        scores = []

        this = self

        last_candidate_program: Optional[int] = None

        def patched_evaluate_call(self, program: dspy.Module, *args, **kwargs):
            nonlocal step, scores, substep, last_candidate_program

            if last_candidate_program != id(program):
                step += 1
                substep = 0
                scores = []
                last_candidate_program = id(program)

            step_ = str(step) if substep == 0 else f"{step}.{substep}"
            substep += 1

            score: float = original_evaluate_call(self, program, *args, **kwargs)  # type: ignore

            scores.append(score)

            if max(scores) == score:
                langwatch_dspy.log_step(
                    optimizer=DSPyOptimizer(
                        name=MIPROv2.__name__,
                        parameters={
                            "num_candidates": this.n,
                            "init_temperature": this.init_temperature,
                        },
                    ),
                    index=step_,
                    score=score,
                    label="score",
                    predictors=[
                        DSPyPredictor(name=name, predictor=predictor)
                        for name, predictor in program.named_predictors()
                    ],
                )

            return score

        Evaluate.__call__ = patched_evaluate_call

        try:
            yield
        finally:
            Evaluate.__call__ = original_evaluate_call


# === Tracer ===#


class DSPyTracer:
    def __init__(self, trace: ContextTrace):
        self.trace = trace

        if not hasattr(dspy.Module, "__original_call__"):
            dspy.Module.__original_call__ = dspy.Module.__call__  # type: ignore
            dspy.Module.__call__ = self.patched_module_call()

        if not hasattr(dspy.Predict, "__original_forward__"):
            dspy.Predict.__original_forward__ = dspy.Predict.forward  # type: ignore
            dspy.Predict.forward = self.patched_predict_forward()

        language_model_classes = dspy.LM.__subclasses__()
        for lm in language_model_classes:
            if not hasattr(lm, "__original_basic_request__"):
                lm.__original_basic_request__ = lm.basic_request  # type: ignore
                lm.basic_request = self.patched_language_model_request()

        retrieve_classes = dspy.Retrieve.__subclasses__()
        for retrieve in retrieve_classes:
            if not hasattr(retrieve, "__original_forward__"):
                retrieve.__original_forward__ = retrieve.forward  # type: ignore
                retrieve.forward = self.patched_retrieve_forward(cls=retrieve)

        if not hasattr(dspy.Retrieve, "__original_forward__"):
            dspy.Retrieve.__original_forward__ = dspy.Retrieve.forward  # type: ignore
            dspy.Retrieve.forward = self.patched_retrieve_forward(cls=dspy.Retrieve)

    def safe_get_current_span(self):
        try:
            return langwatch.get_current_span()
        except:
            return None

    def patched_module_call(self):
        self_ = self

        @langwatch.span(ignore_missing_trace_warning=True, type="chain")
        def __call__(self: dspy.Module, *args, **kwargs):
            span = self_.safe_get_current_span()
            signature = (
                self.__getattribute__("signature")
                if hasattr(self, "signature")
                else None
            )

            if span and signature:
                span.update(name=f"{self.__class__.__name__}({signature.__name__})")
            elif span:
                span.update(name=f"{self.__class__.__name__}.forward")

            prediction = self.__class__.__original_call__(self, *args, **kwargs)  # type: ignore

            if span and isinstance(prediction, dspy.Prediction):
                span.update(output=prediction._store)  # type: ignore

            return prediction

        return __call__

    def patched_predict_forward(self):
        self_ = self

        @langwatch.span(ignore_missing_trace_warning=True, type="chain")
        def forward(self: dspy.Predict, **kwargs):
            span = self_.safe_get_current_span()
            signature = kwargs.get("signature", self.signature)

            if span and signature:
                span.update(name=f"{self.__class__.__name__}({signature.__name__})")

            prediction = self.__class__.__original_forward__(self, **kwargs)  # type: ignore

            if span and isinstance(prediction, dspy.Prediction):
                span.update(output=prediction._store)  # type: ignore

            return prediction

        return forward

    def patched_language_model_request(self):
        self_ = self

        @langwatch.span(ignore_missing_trace_warning=True, type="llm")
        def basic_request(self: dspy.LM, prompt, **kwargs):
            all_kwargs = self.kwargs | kwargs
            model = all_kwargs.get("model", None)
            temperature = all_kwargs.get("temperature", None)

            span = self_.safe_get_current_span()
            if span:
                span.update(
                    name=self.__class__.__name__,
                    model=model,
                    input=prompt,
                    params=({"temperature": temperature} if temperature else None),
                )

            result = self.__class__.__original_basic_request__(self, prompt, **kwargs)  # type: ignore

            if (
                span
                and "choices" in result
                and len(result["choices"]) == 1
                and "message" in result["choices"][0]
            ):
                span.update(output=[result["choices"][0]["message"]])

            if (
                span
                and "usage" in result
                and "completion_tokens" in result["usage"]
                and "prompt_tokens" in result["usage"]
            ):
                span.update(
                    metrics={
                        "completion_tokens": result["usage"]["completion_tokens"],
                        "prompt_tokens": result["usage"]["prompt_tokens"],
                    }
                )

            return result

        return basic_request

    def patched_retrieve_forward(self, cls: Type[dspy.Retrieve]):
        self_ = self

        def forward(self: dspy.Retrieve, *args, **kwargs):
            # Prevent duplicate instrumentation
            if self.__class__ is not cls and getattr(
                cls, "forward", None
            ) is not getattr(dspy.Retrieve, "forward", None):
                return self.__class__.__original_forward__(self, *args, **kwargs)  # type: ignore

            @langwatch.span(ignore_missing_trace_warning=True, type="rag")
            def forward(self, *args, **kwargs):
                result = self.__class__.__original_forward__(self, *args, **kwargs)  # type: ignore

                span = self_.safe_get_current_span()

                passages = result
                try:
                    passages = (
                        result
                        if isinstance(result, list)
                        else result.get("passages", None)
                    )
                except:
                    warnings.warn(
                        f"LangWatch DSPy tracing: passages could not be extracted from the result for {self.__class__.__name__}, please report it at https://github.com/langwatch/langwatch/issues"
                    )
                if span and passages and type(passages) == list:
                    span.update(contexts=passages)

                if span and isinstance(result, dspy.Prediction):
                    span.update(output=result._store)  # type: ignore

                return result

            return forward(self, *args, **kwargs)

        return forward
