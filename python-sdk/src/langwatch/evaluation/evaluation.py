from __future__ import annotations
import asyncio
from contextlib import contextmanager
import json
import threading
import time
import traceback
import nanoid
from typing_extensions import TypedDict
import httpx
import pandas as pd
from opentelemetry import trace
from opentelemetry.context import Context
from typing import (
    Any,
    Callable,
    Dict,
    Iterable,
    Iterator,
    List,
    Optional,
    TypeVar,
    Sized,
    Union,
    cast,
)

from tenacity import retry, stop_after_attempt, wait_exponential
from tqdm.auto import tqdm

import langwatch
from langwatch.attributes import AttributeKey
from langwatch.domain import TypedValueJson
from langwatch.telemetry.tracing import LangWatchTrace
from langwatch.utils.transformation import (
    SerializableWithStringFallback,
    truncate_object_recursively,
    convert_typed_values,
)

from coolname import generate_slug
import urllib.parse
from concurrent.futures import Future, ThreadPoolExecutor, as_completed

_tracer = trace.get_tracer(__name__)

ItemT = TypeVar("ItemT")


class Batch(TypedDict):
    dataset: List[Any]
    evaluations: List[Any]


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

    def __init__(self, name: str):
        self.name: str = name or generate_slug(3)
        self.experiment_slug = self.name
        self.run_id = generate_slug(3)
        self.total = 0
        self.progress = 0
        self.created_at = int(time.time() * 1000)
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
        experiment_path = response.json()["path"]
        self.experiment_slug = response.json()["slug"]

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
        thread_id = "thread" + nanoid.generate(size=10)

        if not self.initialized:
            self.init()

        with _tracer.start_as_current_span(
            "evaluation.loop",
            attributes={
                AttributeKey.LangWatchThreadId: thread_id,
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
                iterable = (
                    cast(Iterable[ItemT], iterable.iterrows())
                    if isinstance(iterable, pd.DataFrame)
                    else cast(Iterable[ItemT], iterable)
                )

                with ThreadPoolExecutor(max_workers=threads) as executor:
                    self._executor = executor

                    for index, item in enumerate(iterable):
                        with _tracer.start_as_current_span(
                            "evaluation.iteration",
                            context=Context(),  # This ensures the iteration span is not a child of the parent, so each iteration is independent
                            attributes={
                                AttributeKey.LangWatchThreadId: thread_id,
                                AttributeKey.LangWatchInput: json.dumps(
                                    TypedValueJson(
                                        type="json",
                                        value=json.dumps(item),
                                    ),
                                    cls=SerializableWithStringFallback,
                                ),
                                "inputs.index": str(index),
                            },
                        ):

                            self._current_index = index
                            self._current_item = item

                            with self._run_item(index, item, in_thread=False):
                                yield item
                            if len(self._futures) == 0:
                                progress_bar.update(1)

                    if len(self._futures) > 0:
                        for _ in as_completed(self._futures):
                            progress_bar.update(1)

                    executor.submit(self._wait_for_completion).result()
                    progress_bar.close()

            except Exception as e:
                Evaluation._post_results(
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
            with self._run_item(_current_index, _current_item, in_thread=True):
                if asyncio.iscoroutinefunction(func):
                    func_result = asyncio.run(func(*args, **kwargs))
                else:
                    func_result = func(*args, **kwargs)

            return func_result

        future = self._executor.submit(wrapper)
        self._futures.append(future)
        return future

    def log(
        self,
        evaluator_name: str,
        index: int,
        data: Dict[str, Any],
        score: float,
        passed: bool,
        cost_cents: int,
        error: Optional[Exception] = None,
    ):
        span = trace.get_current_span()
        span.add_event(
            AttributeKey.LangWatchEventEvaluationLog,
            attributes={
                "evaluator_name": evaluator_name,
                "index": index,
                "data": json.dumps(
                    truncate_object_recursively(convert_typed_values(data)),
                    cls=SerializableWithStringFallback,
                ),
                "score": score,
                "passed": passed,
                "cost_cents": cost_cents,
                "error": json.dumps(
                    truncate_object_recursively(
                        TypedValueJson(
                            type="json",
                            value={
                                "status": "error",
                                "error": error,
                            },
                        ),
                    ),
                    cls=SerializableWithStringFallback,
                ),
            },
        )

    def run(
        self,
        evaluator_name: str,
        data: Dict[str, Any],
        settings: Dict[str, Any],
    ):
        pass

    @contextmanager
    def _run_item(self, index: int, item: Any, in_thread: bool = False) -> Iterator:
        # Iteration will be None if we find ourselves in a parallel loop, but still
        # in the phase of collecting the evaluation.submit() processes. When in_thread,
        # then it's when we actually collect the iteration info.
        iteration = (
            IterationInfo(
                trace=langwatch.trace(name="evaluation.loop.iteration"),
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
            iteration["duration"] = int((time.time() - start_time) * 1000)

            # If we just started the parallel loop, we need to skip the first iteration
            # from being added to the batch and change the trace name
            if not in_thread and len(self._futures) > 0:
                iteration["trace"].update(name="evaluation.loop")
            else:
                self._add_to_batch(iteration)

            if iteration["error"] is not None:
                iteration["trace"].__exit__(
                    type(iteration["error"]),
                    iteration["error"],
                    iteration["error"].__traceback__,
                )
            else:
                iteration["trace"].__exit__(None, None, None)

    def _add_to_batch(self, iteration: IterationInfo):
        entry = (
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
                    "trace_id": iteration["trace"].trace_id,
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
                    "created_at": self.created_at,
                },
            }

            if finished:
                body["timestamps"]["finished_at"] = int(time.time() * 1000)

            # Start a new thread to send the batch
            thread = threading.Thread(
                target=Evaluation._post_results,
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
    def _post_results(cls, api_key: str, body: Dict[str, Any]):
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
