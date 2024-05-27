import os
import time
import dspy
from typing import Callable, List, Optional, Any, Union
from typing_extensions import TypedDict
import langwatch
import httpx
import json
import hashlib
from pydantic import BaseModel
from dspy.predict import Predict
from dspy.signatures.signature import SignatureMeta
from dspy.primitives.prediction import Prediction, Completions
from dspy.primitives.example import Example
from pydantic.fields import FieldInfo
from coolname import generate_slug
from retry import retry


class SerializableAndPydanticEncoder(json.JSONEncoder):
    def default(self, o):
        classname = f"{o.__class__.__module__}.{o.__class__.__name__}"
        if isinstance(o, BaseModel):
            return o.model_dump()
        if isinstance(o, FieldInfo):
            # return {"__class__": classname} | o.__dict__
            return o.__repr__()
        if isinstance(o, set):
            return list(o)
        if isinstance(o, Predict):
            predict_dict = o.__dict__.copy()
            # to prevent two equal predicts but simply different instances
            del predict_dict["stage"]
            return {"__class__": classname} | predict_dict
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
    trace: List[DSPyTrace]


class DSPyStep(BaseModel):
    run_id: str
    experiment_slug: str
    parameters_hash: str
    index: int
    parameters: List[Any]
    examples: List[DSPyExample]
    llm_calls: List[DSPyLLMCall]
    timestamps: Timestamps


class LangWatchDSPy:
    """LangWatch DSPy visualization tracker"""

    _instance: Optional["LangWatchDSPy"] = None
    api_key: Optional[str] = None
    experiment_slug: Optional[str] = None
    batch_send: bool = True
    experiment_path: str = ""

    run_id: Optional[str] = None
    current_step: int = 0
    current_step_hash: Optional[str] = None
    current_step_parameters: Optional[List[Predict]] = None

    llm_calls_buffer: List[DSPyLLMCall] = []
    steps_buffer: List[DSPyStep] = []

    def __new__(cls):
        """
        Singleton Pattern. See https://python-patterns.guide/gang-of-four/singleton/
        """

        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def init(self, experiment: str, batch_send: bool = True):
        self.batch_send = batch_send
        if self.api_key is None:
            if os.environ.get("LANGWATCH_API_KEY") is not None:
                self.api_key = os.environ.get("LANGWATCH_API_KEY")
            else:
                self.login()

        response = httpx.post(
            f"{langwatch.endpoint}/api/dspy/init",
            headers={"X-Auth-Token": self.api_key or ""},
            json={"experiment_slug": experiment},
        )
        if response.status_code == 401:
            self.api_key = None
            raise ValueError("API key is not valid, please try to login again")
        response.raise_for_status()

        self.experiment_slug = experiment
        self.reset()
        self.run_id = None

        self.patch_llms()

        result = response.json()
        self.experiment_path = result["path"]
        print(
            f"Experiment initialized, open {langwatch.endpoint}{self.experiment_path} to track your DSPy training session live"
        )

    def reset(self):
        self.run_id = generate_slug(3)
        self.current_step = 0
        self.current_step_hash = None
        self.llm_calls_buffer = []
        self.steps_buffer = []

    def login(self):
        print(f"Please go to {langwatch.endpoint}/authorize to get your API key")
        self.api_key = input(f"Paste your API key here: ")
        if not self.api_key:
            self.api_key = None
            raise ValueError("API key was not set")
        print("API key set")

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
        if not self.api_key or not self.experiment_slug:
            raise ValueError(
                'langwatch.dspy was not initialized yet, please call langwatch.dspy.init(experiment="your-experiment-name") first'
            )

        self.reset()
        print(f"Tracking run {self.run_id}: {langwatch.endpoint}{self.experiment_path}")

        def wrapped(example, pred, trace=None):
            score = metric_fn(example, pred, trace=trace)  # type: ignore

            is_bootstrap = trace is not None

            trace = dspy.settings.trace
            if not trace:
                return score

            def get_md5(obj):
                return hashlib.md5(
                    json.dumps(obj, cls=SerializableAndPydanticEncoder).encode()
                ).hexdigest()

            # Each trace is a tuple of (parameters, input, pred)
            parameters = list({get_md5(t[0]): t[0] for t in trace}.values())
            md5_of_predict = get_md5(parameters)
            if self.current_step_hash != md5_of_predict:
                self.current_step += 1
                self.current_step_hash = md5_of_predict
                if self.current_step_parameters is not None and not is_bootstrap:
                    self.current_step_parameters = parameters[
                        len(self.current_step_parameters) :
                    ]
                else:
                    self.current_step_parameters = parameters

            self.steps_buffer.append(
                DSPyStep(
                    run_id=self.run_id or "unknown",
                    experiment_slug=self.experiment_slug or "unknown",
                    parameters_hash=self.current_step_hash or "unknown",
                    index=self.current_step,
                    parameters=self.current_step_parameters,  # type: ignore
                    examples=[
                        DSPyExample(
                            example=example._store,
                            pred=pred._store,
                            score=float(score),
                            # Each trace is a tuple of (parameters, input, pred)
                            trace=[],  # [DSPyTrace(input=t[1], pred=t[2]) for t in trace],
                        )
                    ],
                    llm_calls=self.llm_calls_buffer,
                    timestamps=Timestamps(created_at=int(time.time() * 1000)),
                )
            )
            self.llm_calls_buffer = []
            self.send_steps()

            return score

        return wrapped

    @retry(tries=3, delay=0.5)
    def send_steps(self):
        response = httpx.post(
            f"{langwatch.endpoint}/api/dspy/log_steps",
            headers={
                "X-Auth-Token": self.api_key or "",
                "Content-Type": "application/json",
            },
            data=json.dumps(self.steps_buffer, cls=SerializableAndPydanticEncoder),  # type: ignore
        )
        response.raise_for_status()
        self.steps_buffer = []


langwatch_dspy = LangWatchDSPy()
