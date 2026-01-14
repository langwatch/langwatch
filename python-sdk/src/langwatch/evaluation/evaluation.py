from __future__ import annotations
import asyncio
from contextlib import contextmanager
import json
import threading
import time
import traceback
import httpx
import pandas as pd
from opentelemetry import trace
from opentelemetry.trace import Span
from pydantic import BaseModel, Field
from typing import (
    Any,
    Callable,
    Dict,
    Hashable,
    Iterable,
    Iterator,
    List,
    Literal,
    Optional,
    TypeVar,
    TypedDict,
    Sized,
    Union,
    cast,
)

from tenacity import retry, stop_after_attempt, wait_exponential
from tqdm.auto import tqdm

import langwatch
from langwatch.attributes import AttributeKey
from langwatch.domain import Money, TypedValueJson
from langwatch.telemetry.tracing import LangWatchTrace
from langwatch.utils.exceptions import better_raise_for_status
from langwatch.utils.transformation import SerializableWithStringFallback

from coolname import generate_slug  # type: ignore
import urllib.parse
from concurrent.futures import Future, ThreadPoolExecutor, as_completed

_tracer = trace.get_tracer(__name__)

ItemT = TypeVar("ItemT")


class EvaluationResult(BaseModel):
    name: str
    evaluator: str
    trace_id: str
    status: Literal["processed", "error", "skipped"]
    data: Optional[Dict[str, Any]] = None
    score: Optional[float] = Field(default=None, description="No description provided")
    passed: Optional[bool] = None
    details: Optional[str] = Field(
        default=None, description="Short human-readable description of the result"
    )
    index: Optional[int] = None
    label: Optional[str] = None
    cost: Optional[float] = None
    duration: Optional[int] = None
    error_type: Optional[str] = None
    traceback: Optional[List[str]] = Field(
        description="Traceback information for debugging", default=None
    )
    target_id: Optional[str] = Field(
        default=None, description="ID of the target this evaluation is for"
    )


class TargetInfo(BaseModel):
    """Represents a registered target with its metadata."""

    id: str
    name: str
    type: Literal["prompt", "agent", "custom"] = "custom"
    metadata: Optional[Dict[str, Union[str, int, float, bool]]] = None


class Batch(TypedDict):
    dataset: List[BatchEntry]
    evaluations: List[EvaluationResult]
    targets: List[TargetInfo]


class BatchEntry(BaseModel):
    index: int
    entry: Any
    duration: int
    error: Optional[str] = None
    trace_id: str


class IterationInfo(TypedDict):
    index: int
    trace: LangWatchTrace
    item: Any
    duration: int
    error: Optional[Exception]


class Evaluation:
    _executor: ThreadPoolExecutor
    _futures: List[Future[Any]]
    _current_index: int
    _current_item: Any

    def __init__(self, name: str, *, run_id: Optional[str] = None):
        self.name: str = name or generate_slug(3)
        self.experiment_slug: str = self.name
        self.run_id: str = run_id or generate_slug(3)
        self.total: int = 0
        self.progress: int = 0
        self.created_at_nano: int = int(time.time() * 1000)
        self._futures: List[Future[Any]] = []

        # Sending results
        self.lock = threading.Lock()
        self.batch: Batch = {"dataset": [], "evaluations": [], "targets": []}
        self.last_sent = 0
        self.debounce_interval = 1  # 1 second
        self.threads: List[threading.Thread] = []
        self.initialized = False

        # Target registry - tracks registered targets and their metadata
        self._targets: Dict[str, TargetInfo] = {}

    def init(self):
        if not langwatch.get_api_key():
            raise ValueError(
                "API key was not detected, please set LANGWATCH_API_KEY or call langwatch.login() to login"
            )
        langwatch.ensure_setup()

        with httpx.Client(timeout=60) as client:
            response = client.post(
                f"{langwatch.get_endpoint()}/api/experiment/init",
                headers={"X-Auth-Token": langwatch.get_api_key() or ""},
                json={
                    "experiment_name": self.name,
                    "experiment_slug": self.experiment_slug,
                    "experiment_type": "BATCH_EVALUATION_V2",
                },
            )
        if response.status_code == 401:
            langwatch.setup(api_key=None)
            raise ValueError(
                "API key is not valid, please try to login again with langwatch.login()"
            )
        better_raise_for_status(response)
        response_json = response.json()
        experiment_path = response_json["path"]
        self.experiment_slug = response_json["slug"]

        url_encoded_run_id = urllib.parse.quote(self.run_id)
        print(
            f"Follow the results at: {langwatch.get_endpoint()}{experiment_path}?runId={url_encoded_run_id}"
        )
        self.initialized = True

    def loop(
        self,
        iterable: Union[Iterable[ItemT], pd.DataFrame],
        *,
        threads: int = 4,
        total: Optional[int] = None,
    ) -> Iterable[ItemT]:
        if not self.initialized:
            self.init()

        try:
            total_ = (
                total
                if total
                else (
                    len(cast(Sized, iterable)) if hasattr(iterable, "__len__") else None
                )
            )
            if total_ is None and "DataFrame.iterrows" in str(iterable):
                iterable = cast(Iterable[ItemT], list(iterable))
                total_ = len(cast(Sized, iterable))
            progress_bar = tqdm(total=total_, desc="Evaluating")

            # Supports direct pandas df being passed in
            if isinstance(iterable, pd.DataFrame):
                iterable = cast(Iterable[ItemT], iterable.iterrows())  # type: ignore

            with ThreadPoolExecutor(max_workers=threads) as executor:
                self._executor = executor
                for index, item in enumerate(iterable):
                    self._current_index = index
                    self._current_item = item

                    with self._execute_item_iteration(
                        index,
                        item,
                        in_thread=False,
                    ):
                        yield item
                    if len(self._futures) == 0:
                        progress_bar.update(1)

                if len(self._futures) > 0:
                    for _ in as_completed(self._futures):
                        progress_bar.update(1)

                executor.submit(self._wait_for_completion).result()
                progress_bar.close()

        except Exception as e:
            Evaluation._log_results(
                langwatch.get_api_key() or "",
                {
                    "experiment_slug": self.experiment_slug,
                    "run_id": self.run_id,
                    "timestamps": {
                        "finished_at": int(time.time() * 1000),
                        "stopped_at": int(time.time() * 1000),
                    },
                },
            )
            raise e

    def submit(self, func: Callable[..., Any], /, *args: Any, **kwargs: Any):
        _current_index = self._current_index
        _current_item = self._current_item

        def wrapper():
            with self._execute_item_iteration(
                _current_index, _current_item, in_thread=True
            ):
                if asyncio.iscoroutinefunction(func):
                    func_result = asyncio.run(func(*args, **kwargs))
                else:
                    func_result = func(*args, **kwargs)

            return func_result

        future = self._executor.submit(wrapper)
        self._futures.append(future)
        return future

    @contextmanager
    def _execute_item_iteration(
        self,
        index: int,
        item: Any,
        in_thread: bool = False,
    ) -> Iterator[Any]:
        # Iteration will be None if we find ourselves in a parallel loop, but still
        # in the phase of collecting the evaluation.submit() processes. When in_thread,
        # then it's when we actually collect the iteration info.
        iteration = (
            IterationInfo(
                trace=langwatch.trace(
                    name="evaluation.loop_iteration",
                    metadata={
                        "thread_id": self.run_id,
                        "loop.index": str(index),
                    },
                ),
                index=index,
                item=item,
                duration=0,
                error=None,
            )
            if in_thread or len(self._futures) == 0
            else None
        )

        if iteration is not None:
            iteration["trace"].__enter__()

        start_time = time.time()
        try:
            yield
        except Exception as e:
            if iteration is not None:
                iteration["error"] = e
            print(f"\n[Evaluation Error] index={index}")
            traceback.print_exc()

        if iteration is not None:
            try:
                iteration["duration"] = int((time.time() - start_time) * 1000)

                # If we just started the parallel loop, we need to skip the first iteration
                # from being added to the batch and change the trace name
                if not in_thread and len(self._futures) > 0:
                    iteration["trace"].update(name="evaluation.loop")
                else:
                    self._add_to_batch(iteration)

                if iteration["error"] is not None:
                    iteration["trace"].update(error=iteration["error"])
            except Exception as e:
                raise e
            finally:
                iteration["trace"].__exit__(None, None, None)

    def _add_to_batch(self, iteration: IterationInfo):
        entry: Any = (
            iteration["item"].to_dict()
            if hasattr(iteration["item"], "to_dict")
            else (
                iteration["item"].__dict__
                if hasattr(iteration["item"], "__dict__")
                else (
                    iteration["item"][1].to_dict()
                    if type(iteration["item"]) == tuple
                    and hasattr(iteration["item"][1], "to_dict")
                    else (
                        iteration["item"][1].__dict__
                        if type(iteration["item"]) == tuple
                        and hasattr(iteration["item"][1], "__dict__")
                        else {
                            "entry": json.dumps(
                                iteration["item"], cls=SerializableWithStringFallback
                            )
                        }
                    )
                )
            )
        )
        with self.lock:
            self.batch["dataset"].append(
                BatchEntry(
                    index=iteration["index"],
                    entry=entry,
                    duration=iteration["duration"],
                    error=str(iteration["error"]) if iteration["error"] else None,
                    trace_id=iteration["trace"].trace_id or "",
                )
            )

        if time.time() - self.last_sent >= self.debounce_interval:
            self._send_batch()

    def _send_batch(self, finished: bool = False):
        with self.lock:
            if (
                len(self.batch["dataset"]) == 0
                and len(self.batch["evaluations"]) == 0
                and len(self.batch["targets"]) == 0
                and not finished
            ):
                return

            # TODO: it is called `inputs` on the api still, unfortunately, so we need to map data back to inputs
            evaluations = []
            for eval in self.batch["evaluations"]:
                eval_ = eval.model_dump(exclude_none=True, exclude_unset=True)
                eval_["inputs"] = eval_["data"]
                if "data" in eval_:
                    del eval_["data"]
                evaluations.append(eval_)

            # Build targets array for API
            targets = [
                target.model_dump(exclude_none=True, exclude_unset=True)
                for target in self.batch["targets"]
            ]

            body: Dict[str, Any] = {
                "experiment_slug": self.experiment_slug,
                "name": f"{self.name}",
                "run_id": self.run_id,
                "dataset": [
                    entry.model_dump(exclude_none=True, exclude_unset=True)
                    for entry in self.batch["dataset"]
                ],
                "evaluations": evaluations,
                "progress": self.progress,
                "total": self.total,
                "timestamps": {
                    "created_at": self.created_at_nano,
                },
            }

            # Only include targets if we have any
            if len(targets) > 0:
                body["targets"] = targets

            if finished:
                if not isinstance(body["timestamps"], dict):
                    body["timestamps"] = {}
                body["timestamps"]["finished_at"] = int(time.time() * 1000)

            # Start a new thread to send the batch
            thread = threading.Thread(
                target=Evaluation._log_results,
                args=(langwatch.get_api_key(), body),
            )
            thread.start()
            self.threads.append(thread)

            # Clear the batch and update the last sent time
            self.batch = {"dataset": [], "evaluations": [], "targets": []}
            self.last_sent = time.time()

    @classmethod
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    def _log_results(cls, api_key: str, body: Dict[str, Any]):
        response = httpx.post(
            f"{langwatch.get_endpoint()}/api/evaluations/batch/log_results",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            data=json.dumps(body, cls=SerializableWithStringFallback),  # type: ignore
            timeout=60,
        )
        better_raise_for_status(response)

    def _wait_for_completion(self):
        async def wait_for_completion(self: Evaluation):
            # Send any remaining batch
            self._send_batch(finished=True)

            for thread in self.threads:
                await asyncio.sleep(0)
                thread.join()

        asyncio.run(wait_for_completion(self))

    def _register_target(
        self,
        target: str,
        metadata: Optional[Dict[str, Union[str, int, float, bool]]] = None,
    ) -> str:
        """
        Register a target with its metadata. Returns the target ID.

        If the target was already registered:
        - If no new metadata is provided, the existing target is used
        - If new metadata is provided and differs from existing, raises an error

        Args:
            target: The target name/ID
            metadata: Optional metadata for this target (model, temperature, etc.)

        Returns:
            The target ID
        """
        with self.lock:
            if target in self._targets:
                existing = self._targets[target]
                if metadata is not None:
                    # Check if metadata matches
                    existing_meta = existing.metadata or {}
                    if existing_meta != metadata:
                        raise ValueError(
                            f"Target '{target}' was previously registered with different metadata.\n"
                            f"Original: {existing_meta}\n"
                            f"New: {metadata}\n"
                            f"If you want to use different metadata, please use a different target name."
                        )
                return target

            # Register new target
            target_info = TargetInfo(
                id=target,
                name=target,
                type="custom",
                metadata=metadata,
            )
            self._targets[target] = target_info
            self.batch["targets"].append(target_info)
            return target

    def log(
        self,
        metric: str,
        index: Union[int, Hashable],
        data: Dict[str, Any] = {},
        score: Optional[float] = None,
        passed: Optional[bool] = None,
        label: Optional[str] = None,
        details: Optional[str] = None,
        status: Literal["processed", "error", "skipped"] = "processed",
        duration: Optional[int] = None,
        cost: Optional[Money] = None,
        error: Optional[Exception] = None,
        target: Optional[str] = None,
        metadata: Optional[Dict[str, Union[str, int, float, bool]]] = None,
    ):
        """
        Log an evaluation metric result.

        Args:
            metric: Name of the metric being logged
            index: Row index in the dataset (must be an integer)
            data: Additional data/inputs for the evaluation
            score: Numeric score (0-1 typically)
            passed: Whether the evaluation passed
            label: Label/category for the result
            details: Human-readable description of the result
            status: Status of the evaluation ("processed", "error", "skipped")
            duration: Duration in milliseconds
            cost: Cost of the evaluation
            error: Exception if an error occurred
            target: Optional target name for multi-target comparisons.
                    First call with a target name registers it with the provided metadata.
                    Subsequent calls with the same target can omit metadata.
            metadata: Optional metadata for the target (model, temperature, etc.).
                      Only used on the first call for each target.
                      Raises error if conflicting metadata is provided for same target.
        """
        try:
            index_ = int(cast(Any, index))
        except Exception:
            raise ValueError(f"Index must be an integer, got {index}")

        # Register target if provided
        target_id: Optional[str] = None
        if target is not None:
            target_id = self._register_target(target, metadata)

        eval = EvaluationResult(
            trace_id=format(
                trace.get_current_span().get_span_context().trace_id,
                "x",
            ),
            name=metric,
            evaluator=metric,
            status=status if status else "error" if error else "processed",
            data=data,
            score=score,
            passed=passed,
            index=index_,
            label=label,
            cost=cost.amount if cost else None,
            duration=duration,
            details=details if details else str(error) if error else None,
            error_type=type(error).__name__ if error else None,
            traceback=(
                list(traceback.TracebackException.from_exception(error).format())
                if error
                else None
            ),
            target_id=target_id,
        )

        with self.lock:
            self.batch["evaluations"].append(eval)

    def run(
        self,
        evaluator_id: str,
        index: Union[int, Hashable],
        data: Dict[str, Any],
        settings: Dict[str, Any],
        name: Optional[str] = None,
        as_guardrail: bool = False,
    ):
        duration: Optional[int] = None

        start_time = time.time()
        result = langwatch.evaluations.evaluate(
            span=langwatch.get_current_span(),
            slug=evaluator_id,
            name=name or evaluator_id,
            settings=settings,
            as_guardrail=as_guardrail,
            data=data,
        )
        duration = int((time.time() - start_time) * 1000)

        self.log(
            metric=name or evaluator_id,
            index=index,
            data=data,
            status=result.status,
            score=result.score,
            passed=result.passed,
            details=result.details,
            label=result.label,
            duration=duration,
            cost=result.cost,
        )
