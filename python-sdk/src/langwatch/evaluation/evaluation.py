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
    Dict,
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
from langwatch.utils.transformation import SerializableWithStringFallback

from coolname import generate_slug  # type: ignore
import urllib.parse
from concurrent.futures import Future, ThreadPoolExecutor, as_completed

_tracer = trace.get_tracer(__name__)

ItemT = TypeVar("ItemT")


class EvaluationResultProcessed(BaseModel):
    evaluator: str
    trace_id: str
    status: Literal["processed"] = "processed"
    score: Optional[float] = Field(default=None, description="No description provided")
    passed: Optional[bool] = None
    details: Optional[str] = Field(
        default=None, description="Short human-readable description of the result"
    )
    index: Optional[int] = None
    label: Optional[str] = None
    cost: Optional[Money] = None
    duration: Optional[int] = None
    data: Optional[Dict[str, Any]] = None


class EvaluationResultError(BaseModel):
    evaluator: str
    trace_id: str
    status: Literal["error"] = "error"
    error_type: str = Field(description="The type of the exception")
    details: str = Field(description="Error message")
    traceback: List[str] = Field(description="Traceback information for debugging")
    duration: Optional[int] = None
    index: Optional[int] = None
    data: Optional[Dict[str, Any]] = None


class EvaluationResultSkipped(BaseModel):
    status: Literal["skipped"] = "skipped"
    details: Optional[str] = None
    duration: Optional[int] = None
    index: Optional[int] = None


EvaluationResult = Union[
    EvaluationResultProcessed,
    EvaluationResultSkipped,
    EvaluationResultError,
]


class Batch(TypedDict):
    dataset: List[Any]
    evaluations: List[EvaluationResult]


class IterationInfo(TypedDict):
    index: int
    span: Span
    item: Any
    duration: int
    error: Optional[Exception]


class Evaluation:
    _executor: ThreadPoolExecutor
    _futures: List[Future[Any]]
    _current_index: int
    _current_item: Any

    def __init__(self, name: str):
        self.name: str = name or generate_slug(3)
        self.experiment_slug: str = self.name
        self.run_id: str = generate_slug(3)
        self.total: int = 0
        self.progress: int = 0
        self.created_at_nano: int = int(time.time() * 1000)
        self._futures: List[Future[Any]] = []

        # Sending results
        self.lock = threading.Lock()
        self.batch: Batch = {"dataset": [], "evaluations": []}
        self.last_sent = 0
        self.debounce_interval = 1  # 1 second
        self.threads: List[threading.Thread] = []
        self.initialized = False

    def init(self):
        if langwatch.get_api_key() is "":
            raise ValueError(
                "API key was not detected, please set LANGWATCH_API_KEY or call langwatch.login() to login"
            )

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
        response.raise_for_status()
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

        with _tracer.start_as_current_span(
            "evaluation.loop",
            attributes={
                AttributeKey.LangWatchThreadId: self.run_id,
                "inputs.threads": str(threads),
                "inputs.total": str(total),
            },
        ):
            try:
                total_ = (
                    total
                    if total
                    else (
                        len(cast(Sized, iterable))
                        if hasattr(iterable, "__len__")
                        else None
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
                span=_tracer.start_span(
                    "evaluation.loop_iteration",
                    # This ensures the iteration span is not a child of the parent
                    # so that each iteration is it's own root span
                    attributes={
                        AttributeKey.LangWatchThreadId: self.run_id,
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

        try:
            start_time = time.time()
            try:
                yield
            except Exception as e:
                if iteration is not None:
                    iteration["error"] = e
                print(f"\n[Evaluation Error] index={index}")
                traceback.print_exc()

            if iteration is not None:
                iteration["duration"] = int((time.time() - start_time) * 1000)

                # If we just started the parallel loop, we need to skip the first iteration
                # from being added to the batch and change the trace name
                if not in_thread and len(self._futures) > 0:
                    iteration["span"].update_name("evaluation.loop")
                else:
                    iteration["span"].set_attributes(
                        {
                            "inputs.index": str(index),
                            "inputs.item": json.dumps(
                                TypedValueJson(
                                    type="json",
                                    value=json.dumps(item),
                                ),
                            ),
                        }
                    )
                    self._add_to_batch(iteration)

                if iteration["error"] is not None:
                    iteration["span"].record_exception(iteration["error"])
        finally:
            if iteration is not None:
                iteration["span"].end()

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
                {
                    "index": iteration["index"],
                    "entry": entry,
                    "duration": iteration["duration"],
                    "error": iteration["error"],
                    "trace_id": format(
                        iteration["span"].get_span_context().trace_id, "x"
                    ),
                }
            )

        if time.time() - self.last_sent >= self.debounce_interval:
            self._send_batch()

    def _send_batch(self, finished: bool = False):
        with self.lock:
            if (
                len(self.batch["dataset"]) == 0
                and len(self.batch["evaluations"]) == 0
                and not finished
            ):
                return

            body = {
                "experiment_slug": self.experiment_slug,
                "name": f"{self.name}",
                "run_id": self.run_id,
                "dataset": self.batch["dataset"],
                "evaluations": self.batch["evaluations"],
                "progress": self.progress,
                "total": self.total,
                "timestamps": {
                    "created_at": self.created_at_nano,
                },
            }

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
            self.batch = {"dataset": [], "evaluations": []}
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
        response.raise_for_status()

    def _wait_for_completion(self):
        async def wait_for_completion(self: Evaluation):
            # Send any remaining batch
            self._send_batch(finished=True)

            for thread in self.threads:
                await asyncio.sleep(0)
                thread.join()

        asyncio.run(wait_for_completion(self))

    def log(
        self,
        evaluator_name: str,
        index: int,
        data: Dict[str, Any],
        score: Optional[float] = None,
        passed: Optional[bool] = None,
        duration: Optional[int] = None,
        label: Optional[str] = None,
        details: Optional[str] = None,
    ):
        eval = EvaluationResultProcessed(
            trace_id=format(
                trace.get_current_span().get_span_context().trace_id,
                "x",
            ),
            evaluator=evaluator_name,
            status="processed",
            score=score,
            passed=passed,
            duration=duration,
            index=index,
            data=data,
            label=label,
            details=details,
        )

        with self.lock:
            self.batch["evaluations"].append(eval)

    def log_error(
        self,
        evaluator_name: str,
        index: int,
        data: Dict[str, Any],
        error: Exception,
        duration: Optional[int] = None,
    ):
        # tracebacks can be slow, so we should do this outside of the lock
        eval = EvaluationResultError(
            trace_id=format(
                trace.get_current_span().get_span_context().trace_id,
                "x",
            ),
            evaluator=evaluator_name,
            status="error",
            error_type=type(error).__name__,
            details=str(error),
            traceback=list(traceback.TracebackException.from_exception(error).format()),
            duration=duration,
            index=index,
            data=data,
        )

        with self.lock:
            self.batch["evaluations"].append(eval)

    async def run(
        self,
        evaluator_name: str,
        index: int,
        data: Dict[str, Any],
        settings: Dict[str, Any],
    ):
        # export const evaluationInputSchema = z.object({
        # trace_id: z.string().optional().nullable(),
        # evaluation_id: z.string().optional().nullable(),
        # evaluator_id: z.string().optional().nullable(),
        # name: z.string().optional().nullable(),
        # data: z.object({}).passthrough().optional().nullable(),
        # settings: z.object({}).passthrough().optional().nullable(),
        # as_guardrail: z.boolean().optional().nullable().default(false),
        # });

        duration: Optional[int] = None

        try:
            json_body = {}
            request_params = {
                "url": f"{langwatch.get_endpoint()}/api/evaluations/{evaluator_name}/evaluate",
                "headers": {"X-Auth-Token": langwatch.get_api_key()},
                "json": json_body,
            }

            start_time = time.time()

            async with httpx.AsyncClient(timeout=900) as client:
                response = await client.post(**request_params)
                response.raise_for_status()

            result = response.json()
            duration = int((time.time() - start_time) * 1000)

            evaluation_result: EvaluationResult
            if result["status"] == "processed":
                evaluation_result = EvaluationResultProcessed.model_validate(result)
            elif result["status"] == "skipped":
                evaluation_result = EvaluationResultSkipped.model_validate(result)
            else:
                evaluation_result = EvaluationResultError.model_validate(
                    {"traceback": [], **(result or {})}
                )

            evaluation_result.duration = duration

            if evaluation_result.status == "processed":
                self.log(
                    evaluator_name=evaluator_name,
                    index=index,
                    details=evaluation_result.details,
                    data=data,
                    score=evaluation_result.score,
                    passed=evaluation_result.passed,
                    duration=duration,
                    label=evaluation_result.label,
                )
            elif evaluation_result.status == "skipped":
                self.log(
                    evaluator_name=evaluator_name,
                    index=index,
                    details=evaluation_result.details,
                    data=data,
                )
            else:
                self.log_error(
                    evaluator_name=evaluator_name,
                    index=index,
                    data=data,
                    error=evaluation_result.error_type,
                    duration=duration,
                )

        except httpx.HTTPStatusError as e:
            if e.response.status_code // 100 == 4:
                raise Exception(f"HTTP error: {e.response.text}")

            self.log_error(
                evaluator_name=evaluator_name,
                index=index,
                data=data,
                error=e,
                duration=duration,
            )

        except Exception as e:
            self.log_error(
                evaluator_name=evaluator_name,
                index=index,
                data=data,
                error=e,
                duration=duration,
            )
