from __future__ import annotations
import asyncio
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
import json
import threading
import time
import traceback
import httpx
import pandas as pd
from opentelemetry import trace, context as otel_context
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


@dataclass
class TargetContext:
    """Context for the current target() execution."""

    target_id: str
    index: int
    trace_id: str
    predicted: Optional[Dict[str, Any]] = None  # Set via log_response()


@dataclass
class IterationContext:
    """Context for the current iteration (index + item)."""

    index: int
    item: Any


# ContextVar for target context isolation (works across threads)
_target_context: ContextVar[Optional[TargetContext]] = ContextVar(
    "_target_context", default=None
)

# ContextVar for iteration context (index + item) - thread-safe
_iteration_context: ContextVar[Optional[IterationContext]] = ContextVar(
    "_iteration_context", default=None
)

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
    target_id: Optional[str] = None
    cost: Optional[float] = None
    predicted: Optional[Dict[str, Any]] = None


class IterationInfo(TypedDict):
    index: int
    trace: LangWatchTrace
    item: Any
    duration: int
    error: Optional[Exception]


class Experiment:
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

        # Track whether with_target() was used in the current iteration
        # If so, we don't create row-level dataset entries
        self._current_iteration_used_with_target = False

        # Track whether target() has EVER been used in this evaluation
        # Once set to True, we stop creating iteration-level traces
        self._evaluation_uses_targets: bool = False

        # Store the active iteration trace so target() can close it early
        self._active_iteration_trace: Optional[LangWatchTrace] = None

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
            Experiment._log_results(
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
        # Reset with_target tracking for this iteration
        self._current_iteration_used_with_target = False

        # Set iteration context (thread-safe via contextvars)
        # This allows target() to access index/item without race conditions
        iter_ctx = IterationContext(index=index, item=item)
        iter_token = _iteration_context.set(iter_ctx)

        # Determine if we should create an iteration trace:
        # - Don't create if evaluation uses targets (each target creates its own trace)
        # - Don't create if we're collecting submit() calls (not in_thread yet)
        should_create_iteration_trace = (
            not self._evaluation_uses_targets
            and (in_thread or len(self._futures) == 0)
        )

        iteration: Optional[IterationInfo] = None
        if should_create_iteration_trace:
            iteration = IterationInfo(
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
            iteration["trace"].__enter__()
            # Store for target() to potentially close early
            self._active_iteration_trace = iteration["trace"]

        start_time = time.time()
        try:
            yield
        except Exception as e:
            if iteration is not None:
                iteration["error"] = e
            print(f"\n[Evaluation Error] index={index}")
            traceback.print_exc()
        finally:
            # Reset iteration context
            _iteration_context.reset(iter_token)

        # Handle iteration trace cleanup
        # Note: If target() was used, it may have already closed the trace
        if iteration is not None and not self._evaluation_uses_targets:
            try:
                iteration["duration"] = int((time.time() - start_time) * 1000)

                # If we just started the parallel loop, we need to skip the first iteration
                # from being added to the batch and change the trace name
                if not in_thread and len(self._futures) > 0:
                    iteration["trace"].update(name="evaluation.loop")
                # Only add row-level entry if with_target was NOT used
                # When with_target is used, it creates per-target dataset entries instead
                elif not self._current_iteration_used_with_target:
                    self._add_to_batch(iteration)

                if iteration["error"] is not None:
                    iteration["trace"].update(error=iteration["error"])
            except Exception as e:
                raise e
            finally:
                iteration["trace"].__exit__(None, None, None)

        # Clear active iteration trace reference
        self._active_iteration_trace = None

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
                target=Experiment._log_results,
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
        async def wait_for_completion(self: Experiment):
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

    @contextmanager
    def target(
        self,
        name: str,
        metadata: Optional[Dict[str, Union[str, int, float, bool]]] = None,
    ) -> Iterator[None]:
        """
        Context manager for executing code within a target context.

        Creates a dataset entry for this specific target execution, capturing
        duration automatically. This enables proper per-target latency tracking
        when comparing multiple models/configurations.

        Each target() call creates its own independent trace, allowing you to
        view execution details separately for each model/configuration.

        Inside this context, log() calls will automatically use this target
        unless an explicit target is provided.

        Args:
            name: Unique identifier for the target
            metadata: Optional metadata for comparison (e.g., {"model": "gpt-4"})

        Example:
            ```python
            for index, row in evaluation.loop(df.iterrows()):
                def task(index, row):
                    # Compare GPT-4 and Claude
                    with evaluation.target("gpt-4", {"model": "openai/gpt-4"}):
                        response = call_gpt4(row["question"])
                        # target auto-inferred, use data= to record output
                        evaluation.log("quality", index=index, score=0.95,
                                       data={"output": response})

                    with evaluation.target("claude", {"model": "anthropic/claude"}):
                        response = call_claude(row["question"])
                        evaluation.log("quality", index=index, score=0.85,
                                       data={"output": response})

                evaluation.submit(task, index, row)
            ```
        """
        # On FIRST target() call ever in this evaluation:
        # - Set flag to skip creating iteration-level traces going forward
        # - Close the active iteration trace if any (it won't have useful content)
        if not self._evaluation_uses_targets:
            self._evaluation_uses_targets = True
            # Close the active iteration trace early
            if self._active_iteration_trace is not None:
                self._active_iteration_trace.__exit__(None, None, None)
                self._active_iteration_trace = None

        # Mark that target() was used in this iteration (for dataset entry logic)
        self._current_iteration_used_with_target = True

        # Register target
        self._register_target(name, metadata)

        # Get index and item from iteration context (thread-safe via contextvars)
        # This prevents race conditions when multiple threads are running evaluations
        iter_ctx = _iteration_context.get()
        if iter_ctx is not None:
            index = iter_ctx.index
            current_item = iter_ctx.item
        else:
            # Fallback to instance variables (for backwards compatibility / direct usage)
            index = self._current_index
            current_item = self._current_item

        target_trace: Optional[LangWatchTrace] = None
        start_time = time.time()
        error_occurred: Optional[Exception] = None
        trace_id = ""

        # Set up context for log() inference
        ctx = TargetContext(
            target_id=name,
            index=index,
            trace_id="",  # Will be set after entering trace
        )
        target_context_token = _target_context.set(ctx)

        try:
            # Create an INDEPENDENT root trace for this target
            # We use a new tracer without any parent context to get a unique trace_id
            # The key is using the tracer directly with context=None to prevent
            # parent context inheritance
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.trace import INVALID_SPAN_CONTEXT

            tracer = trace.get_tracer("langwatch-evaluation")

            # Start a new root span with no parent by passing an empty context
            # This ensures each target gets a unique trace_id
            root_context = otel_context.Context()

            with tracer.start_as_current_span(
                f"evaluation.target.{name}",
                context=root_context,
                attributes={
                    "evaluation.run_id": self.run_id,
                    "evaluation.index": index,
                    "evaluation.target": name,
                },
            ) as span:
                span_context = span.get_span_context()
                trace_id = format(span_context.trace_id, "032x")
                ctx.trace_id = trace_id

                try:
                    yield
                except Exception as e:
                    error_occurred = e
                    raise

        except Exception as e:
            if error_occurred is None:
                error_occurred = e
            raise
        finally:
            duration_ms = int((time.time() - start_time) * 1000)

            # Create dataset entry for this target
            # Use the captured current_item, NOT self._current_item (which may have changed)
            entry_data: Any = (
                current_item.to_dict()
                if hasattr(current_item, "to_dict")
                else (
                    current_item.__dict__
                    if hasattr(current_item, "__dict__")
                    else (
                        current_item[1].to_dict()
                        if type(current_item) == tuple
                        and hasattr(current_item[1], "to_dict")
                        else (
                            current_item[1].__dict__
                            if type(current_item) == tuple
                            and hasattr(current_item[1], "__dict__")
                            else {
                                "entry": json.dumps(
                                    current_item, cls=SerializableWithStringFallback
                                )
                            }
                        )
                    )
                )
            )

            # Get predicted output from context (set via log_response())
            predicted = ctx.predicted

            batch_entry = BatchEntry(
                index=index,
                entry=entry_data,
                duration=duration_ms,
                error=str(error_occurred) if error_occurred else None,
                trace_id=trace_id,
                target_id=name,
                predicted=predicted,
            )

            with self.lock:
                self.batch["dataset"].append(batch_entry)

            # Reset target context
            _target_context.reset(target_context_token)

            # Schedule send
            if time.time() - self.last_sent >= self.debounce_interval:
                self._send_batch()

    def log_response(self, response: Union[str, Dict[str, Any]]) -> None:
        """
        Log the model's response/output for the current target.

        Must be called inside a `target()` context. The response will be stored
        in the dataset entry's `predicted` field, which is displayed in the
        results table.

        Args:
            response: The model's output. Can be a string (will be wrapped as
                     {"output": response}) or a dict with named outputs.

        Example:
            ```python
            with evaluation.target("gpt-4", {"model": "openai/gpt-4"}):
                response = call_gpt4(row["question"])
                evaluation.log_response(response)  # Store the output
                evaluation.log("quality", index=index, score=0.95)  # Log metrics
            ```

        Raises:
            RuntimeError: If called outside of a target() context.
        """
        ctx = _target_context.get()
        if ctx is None:
            raise RuntimeError(
                "log_response() must be called inside a target() context. "
                "Example: with evaluation.target('my-target'): evaluation.log_response(response)"
            )

        # Normalize response to dict format
        if isinstance(response, str):
            ctx.predicted = {"output": response}
        elif isinstance(response, dict):
            ctx.predicted = response
        else:
            # Try to convert to string for other types
            ctx.predicted = {"output": str(response)}

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
                    If called inside with_target(), the target is auto-inferred from context.
            metadata: Optional metadata for the target (model, temperature, etc.).
                      Only used on the first call for each target.
                      Raises error if conflicting metadata is provided for same target.
        """
        try:
            index_ = int(cast(Any, index))
        except Exception:
            raise ValueError(f"Index must be an integer, got {index}")

        # Get target context (if inside with_target)
        ctx = _target_context.get()

        # Use context target if not explicitly provided
        effective_target = target if target is not None else (ctx.target_id if ctx else None)

        # Register target if provided (explicit or from context)
        target_id: Optional[str] = None
        if effective_target is not None:
            target_id = self._register_target(effective_target, metadata)

        # Use trace_id from context if available
        trace_id = (
            ctx.trace_id
            if ctx
            else format(trace.get_current_span().get_span_context().trace_id, "x")
        )

        eval = EvaluationResult(
            trace_id=trace_id,
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

    def evaluate(
        self,
        evaluator_id: str,
        index: Union[int, Hashable],
        data: Dict[str, Any],
        settings: Dict[str, Any],
        name: Optional[str] = None,
        as_guardrail: bool = False,
    ):
        """
        Run an evaluator on the current row.

        Args:
            evaluator_id: The evaluator type/slug (e.g., "langevals/exact_match", "ragas/faithfulness")
            index: The row index for this evaluation
            data: Data to pass to the evaluator (e.g., {"input": ..., "output": ..., "expected_output": ...})
            settings: Evaluator-specific settings
            name: Optional display name for the evaluation (defaults to evaluator_id)
            as_guardrail: Whether to run as a guardrail (stricter pass/fail)
        """
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

    def run(
        self,
        evaluator_id: str,
        index: Union[int, Hashable],
        data: Dict[str, Any],
        settings: Dict[str, Any],
        name: Optional[str] = None,
        as_guardrail: bool = False,
    ):
        """
        Deprecated: Use `evaluate()` instead.
        """
        import warnings

        warnings.warn(
            "evaluation.run() is deprecated, use evaluation.evaluate() instead",
            DeprecationWarning,
            stacklevel=2,
        )
        return self.evaluate(
            evaluator_id=evaluator_id,
            index=index,
            data=data,
            settings=settings,
            name=name,
            as_guardrail=as_guardrail,
        )
