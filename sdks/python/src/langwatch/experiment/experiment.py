from __future__ import annotations
import asyncio
from collections import OrderedDict
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
import json
import sys
import threading
import time
import traceback
import httpx
from opentelemetry import trace, context as otel_context
from opentelemetry.trace import Span
from pydantic import BaseModel, Field
from typing import (
    TYPE_CHECKING,
    Any,
    Callable,
    Dict,
    Hashable,
    Iterable,
    Iterator,
    List,
    Literal,
    Optional,
    Sequence,
    TypeVar,
    TypedDict,
    Sized,
    Union,
    cast,
)

if TYPE_CHECKING:
    import pandas as pd

    from langwatch.evaluation import EvaluationResultModel

from tenacity import retry, stop_after_attempt, wait_exponential
from tqdm.auto import tqdm

import langwatch
from langwatch.attributes import AttributeKey
from langwatch.domain import Money, TypedValueJson
from langwatch.experiment._results_df import build_results_df
from langwatch.experiment.platform_run import (
    EvaluatorStats,
    ExperimentRunResult,
    ExperimentRunSummary,
    TargetStats,
    _is_notebook,
    _print_summary,
)
from langwatch.telemetry.tracing import LangWatchTrace
from langwatch.utils.auth import build_auth_headers
from langwatch.utils.exceptions import better_raise_for_status
from langwatch.utils.transformation import SerializableWithStringFallback

from coolname import generate_slug  # type: ignore
import urllib.parse
from concurrent.futures import Future, ThreadPoolExecutor, as_completed

_tracer = trace.get_tracer(__name__)


def _is_dataframe(obj: object) -> bool:
    """True when obj is a pandas DataFrame, without importing pandas.

    Checked via sys.modules so plain iterables never pull pandas in: if
    pandas was never imported, obj cannot be a DataFrame (pandas is an
    optional dependency of the SDK).
    """
    pd = sys.modules.get("pandas")
    return pd is not None and isinstance(obj, pd.DataFrame)


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
    started_at: float = 0.0


# ContextVar for target context isolation (works across threads)
_target_context: ContextVar[Optional[TargetContext]] = ContextVar(
    "_target_context", default=None
)

# ContextVar for iteration context (index + item) - thread-safe
_iteration_context: ContextVar[Optional[IterationContext]] = ContextVar(
    "_iteration_context", default=None
)

# Active iteration trace, per iteration context. Stored in a ContextVar
# (rather than on the Experiment instance) so concurrent async tasks don't
# step on each other — otherwise task A's log_response / target() call would
# close task B's iteration trace, leaving OTel context tokens dangling and
# raising "Failed to detach context: Token was created in a different
# Context" during async-gen cleanup.
_active_iteration_trace_ctx: ContextVar[Optional[Any]] = ContextVar(
    "_active_iteration_trace_ctx", default=None
)


def _scalar_or_json_entry(item: Any) -> Dict[str, Any]:
    """Shape a loop item as a dataset ``entry`` payload.

    Plain scalars (str/int/float/bool) are stored unwrapped — `"New York"`
    comes back as `"New York"`, not the doubly-quoted `'"New York"'`.
    Everything else is JSON-stringified with the fallback encoder.
    """
    if isinstance(item, (str, int, float, bool)) or item is None:
        return {"entry": item}
    return {"entry": json.dumps(item, cls=SerializableWithStringFallback)}

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


# The judge behind every comparison. Two candidates is not a different
# feature from five, so there is exactly one evaluator for any N.
COMPARISON_EVALUATOR = "langevals/select_best_compare"

# How many rows of recorded target outputs stay readable by compare().
# A comparison reads the row it is given, which is the row the loop is on or
# one still in flight, so this bound is never reached by a well-formed run.
# It is what keeps a million-row run from holding every output it produced.
_MAX_TRACKED_OUTPUT_ROWS = 1000


ComparisonStatus = Literal["decided", "tie", "inconclusive", "skipped", "error"]


@dataclass(frozen=True)
class ComparisonVerdict:
    """The outcome of comparing a row's target outputs.

    ``status`` is one of:

    - "decided": the judge picked a winner, named in ``winner``.
    - "tie": the judge found no candidate clearly better than the others.
    - "inconclusive": the judge reached a verdict it could not stand behind,
      so the candidates are too close to call.
    - "skipped": the row had fewer than two outputs, so no judge was called.
    - "error": the judge failed or could not be reached.

    Each of the last three is its own answer, and collapsing any of them into
    a tie or into each other reports something the run never established. A
    tie says the candidates are equally good. Inconclusive says they are too
    close to separate, which is what a swap-and-reconcile disagreement means:
    the verdict did not survive reversing the candidate order. An error says
    nothing about the candidates at all, only that the judge failed, and
    ``reasoning`` carries what went wrong.
    """

    status: ComparisonStatus
    winner: Optional[str]
    reasoning: Optional[str]
    candidates: List[str]


# The batch protocol has three statuses, so each verdict resolves to exactly
# one of them here. Every recording path reads the wire status out of this
# table rather than naming one alongside a verdict, which is what keeps the
# status a caller reads and the status the platform stores from disagreeing.
_COMPARISON_ENTRY_STATUS: Dict[
    ComparisonStatus, Literal["processed", "error", "skipped"]
] = {
    "decided": "processed",
    "tie": "processed",
    "inconclusive": "skipped",
    "skipped": "skipped",
    "error": "error",
}


@dataclass
class _RecordedOutput:
    """What one target produced for one row, kept outside the batch.

    The batch is flushed on a debounce timer, so the dataset entries carrying
    these outputs are often already sent and cleared by the time compare()
    runs. This is the copy compare() reads.

    ``duration`` is in seconds, which is what the judge renders.
    """

    output: str
    duration: Optional[float] = None


@dataclass
class _ComparisonRequest:
    """A judge call built for a row, plus what recording its verdict needs."""

    index: int
    name: str
    candidates: List[str]
    data: Dict[str, Any]
    settings: Dict[str, Any]


def _predicted_as_text(predicted: Optional[Dict[str, Any]]) -> str:
    """Flatten a recorded response into the text a judge can compare.

    A lone ``output`` field is unwrapped to its own value, so a plain string
    response reaches the judge as itself. A structured response with several
    fields is presented whole, as JSON.
    """
    if not predicted:
        return ""
    if len(predicted) == 1 and "output" in predicted:
        value = predicted["output"]
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        return json.dumps(value, cls=SerializableWithStringFallback)
    return json.dumps(predicted, cls=SerializableWithStringFallback)


def _current_trace_id() -> str:
    """The active trace id, hex-encoded."""
    return format(trace.get_current_span().get_span_context().trace_id, "x")


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
        # Async-native execution state (used by aloop / asubmit). The threading
        # path keeps these empty, so every check downstream is a no-op for it.
        self._async_tasks: List["asyncio.Task[Any]"] = []
        self._async_semaphore: Optional[asyncio.Semaphore] = None

        # Sending results
        self.lock = threading.Lock()
        self.batch: Batch = {"dataset": [], "evaluations": [], "targets": []}
        self.last_sent = 0
        self.debounce_interval = 1  # 1 second
        self.threads: List[threading.Thread] = []
        self.initialized = False

        # Target registry - tracks registered targets and their metadata
        self._targets: Dict[str, TargetInfo] = {}

        # Per-row, per-target outputs for compare(), independent of the batch
        # and of when it is flushed. Ordered so the rows the run has moved
        # past can be dropped once the map grows past its bound.
        self._row_outputs: OrderedDict[int, Dict[str, _RecordedOutput]] = (
            OrderedDict()
        )
        self._row_outputs_lock = threading.Lock()

        # Track whether with_target() was used in the current iteration
        # If so, we don't create row-level dataset entries
        self._current_iteration_used_with_target = False

        # Track whether target() has EVER been used in this evaluation
        # Once set to True, we stop creating iteration-level traces
        self._evaluation_uses_targets: bool = False

        # Active iteration trace is stored in `_active_iteration_trace_ctx`
        # (a module-level ContextVar) so concurrent asyncio tasks each see
        # their OWN iteration trace — not a shared last-writer-wins field on
        # the Experiment instance.

        self._finished: bool = False
        self._run_url: Optional[str] = None
        self._cached_results_df: Optional[pd.DataFrame] = None

    def init(self):
        if not langwatch.get_api_key():
            raise ValueError(
                "API key was not detected, please set LANGWATCH_API_KEY or call langwatch.login() to login"
            )
        langwatch.ensure_setup()

        with httpx.Client(timeout=60) as client:
            response = client.post(
                f"{langwatch.get_endpoint()}/api/experiment/init",
                headers=build_auth_headers(langwatch.get_api_key() or ""),
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
        self._run_url = f"{langwatch.get_endpoint()}{experiment_path}?runId={url_encoded_run_id}"
        print(f"Follow the results at: {self._run_url}")
        self.initialized = True

    @property
    def results(self) -> pd.DataFrame:
        """
        Per-row evaluation results as a pandas DataFrame, fetched from the platform.

        Each row corresponds to one dataset entry (or one entry per target in
        multi-target experiments). Columns include the input data, output,
        trace_id, duration_ms, cost, plus one column per evaluation metric.

        The platform is the single source of truth — costs are computed from
        traces, durations are accurate, and all data is consistent.

        Example::

            evaluation.results                    # renders as table in Jupyter
            evaluation.results.describe()         # summary statistics
            evaluation.results["my_metric"].mean() # aggregate a metric
            evaluation.results.groupby("target")["quality"].mean()
        """
        if self._cached_results_df is not None:
            return self._cached_results_df

        df = self._fetch_results_as_df()
        self._cached_results_df = df
        return df

    def _fetch_results_as_df(self, retries: int = 5, delay: float = 3.0) -> pd.DataFrame:
        """Fetch per-row results from the platform and build a DataFrame."""
        # Imported lazily so importing langwatch.experiment does not require
        # pandas; it is only needed when reading per-row results back.
        import pandas as pd

        endpoint = langwatch.get_endpoint()
        api_key = langwatch.get_api_key() or ""

        url = (
            f"{endpoint}/api/evaluations/v3/runs/"
            f"{urllib.parse.quote(self.run_id)}/results"
            f"?experimentSlug={urllib.parse.quote(self.experiment_slug)}"
        )

        for attempt in range(retries):
            try:
                with httpx.Client(timeout=30) as client:
                    response = client.get(url, headers=build_auth_headers(api_key))

                if response.status_code == 404:
                    if attempt < retries - 1:
                        time.sleep(delay)
                        continue
                    return pd.DataFrame()

                if response.is_success:
                    data = response.json()
                    return self._build_df_from_platform(data)

            except Exception:
                if attempt < retries - 1:
                    time.sleep(delay)
                    continue

        return pd.DataFrame()

    @staticmethod
    def _build_df_from_platform(data: Dict[str, Any]) -> pd.DataFrame:
        """Build a DataFrame from the platform API response (ExperimentRunWithItems)."""
        return build_results_df(data)

    def _auto_display_results(self) -> None:
        """Fetch and display results after loop completion."""
        try:
            # Wait for platform to process final batch + traces
            time.sleep(5)

            df = self._fetch_results_as_df()
            if df.empty:
                if self._run_url:
                    print(f"\n  View details: {self._run_url}\n")
                return

            self._cached_results_df = df
            print()
            self._display_df(df)

            if self._run_url:
                print(f"\n  View details: {self._run_url}")
            print(f"  Explore with: `evaluation.results`\n")
        except Exception:
            # Non-fatal: don't crash the experiment if result display fails
            if self._run_url:
                print(f"\n  View details: {self._run_url}\n")

    @staticmethod
    def _display_df(df: pd.DataFrame) -> None:
        try:
            from IPython.display import display
            from IPython import get_ipython
            if get_ipython() is not None:
                display(df)
                return
        except (ImportError, AttributeError):
            # IPython not available — fall through to text display
            pass
        print(df.to_string())

    def print_summary(self, exit_on_failure: Optional[bool] = None) -> None:
        """
        Print a CI-friendly summary of the experiment and optionally exit with code 1 on failure.

        Mirrors ``ExperimentRunResult.print_summary`` for parity — SDK-driven
        experiments (``langwatch.experiment.init(...)`` + ``loop`` + ``evaluate``) can
        now fail CI builds the same way platform experiments (``langwatch.experiment.run(slug)``) do.

        Args:
            exit_on_failure: If True, calls ``sys.exit(1)`` when there are failures.
                             If False, never exits. If None (default), auto-detects:
                             exits in scripts/CI, doesn't in Jupyter notebooks.

        Example::

            experiment = langwatch.experiment.init("ci-quality-check")
            for idx, row in experiment.loop(dataset.iterrows()):
                response = my_llm(row["input"])
                experiment.evaluate("ragas/faithfulness", index=idx, data={...})

            experiment.print_summary()
        """
        result = self._build_run_result()
        _print_summary(result)

        should_exit = exit_on_failure if exit_on_failure is not None else not _is_notebook()
        if should_exit and (result.failed > 0 or result.summary.failed_cells > 0):
            sys.exit(1)

    def _build_run_result(self) -> ExperimentRunResult:
        """Build an ExperimentRunResult from the current results DataFrame."""
        # Imported lazily so importing langwatch.experiment does not require
        # pandas; this path only runs on DataFrames built from fetched results.
        import pandas as pd
        run_url = self._run_url or ""
        df = self.results

        if df is None or df.empty:
            empty_summary = ExperimentRunSummary(
                run_id=self.run_id,
                total_cells=0,
                completed_cells=0,
                failed_cells=0,
                duration=0,
                run_url=run_url,
            )
            return ExperimentRunResult(
                run_id=self.run_id,
                status="completed",
                passed=0,
                failed=0,
                pass_rate=0.0,
                duration=0,
                run_url=run_url,
                summary=empty_summary,
            )

        # Flatten any MultiIndex so we can access columns uniformly.
        flat = df.reset_index() if df.index.names and any(n is not None for n in df.index.names) else df

        passed_cols = [c for c in flat.columns if isinstance(c, str) and c.endswith("_passed")]

        total_passed = 0
        total_failed = 0
        evaluators: List[EvaluatorStats] = []
        for pcol in passed_cols:
            name = pcol[: -len("_passed")]
            col = flat[pcol].dropna()
            passed = int((col == True).sum())  # noqa: E712 — pandas comparison
            failed = int((col == False).sum())  # noqa: E712
            total_passed += passed
            total_failed += failed

            avg_score: Optional[float] = None
            if name in flat.columns:
                numeric = pd.to_numeric(flat[name], errors="coerce").dropna()
                if not numeric.empty:
                    avg_score = float(numeric.mean())

            subtotal = passed + failed
            eval_pass_rate = (passed / subtotal * 100.0) if subtotal > 0 else 0.0
            evaluators.append(
                EvaluatorStats(
                    evaluator_id=name,
                    name=name,
                    passed=passed,
                    failed=failed,
                    pass_rate=eval_pass_rate,
                    avg_score=avg_score,
                )
            )

        targets: List[TargetStats] = []
        if "target" in flat.columns:
            for target_id, sub in flat.groupby("target"):
                t_passed = 0
                t_failed = 0
                for pcol in passed_cols:
                    if pcol not in sub.columns:
                        continue
                    sub_col = sub[pcol].dropna()
                    t_passed += int((sub_col == True).sum())  # noqa: E712
                    t_failed += int((sub_col == False).sum())  # noqa: E712

                avg_latency = 0.0
                if "duration_ms" in sub.columns:
                    dur_numeric = pd.to_numeric(sub["duration_ms"], errors="coerce").dropna()
                    if not dur_numeric.empty:
                        avg_latency = float(dur_numeric.mean())

                t_cost = 0.0
                if "cost" in sub.columns:
                    cost_numeric = pd.to_numeric(sub["cost"], errors="coerce").dropna()
                    if not cost_numeric.empty:
                        t_cost = float(cost_numeric.sum())

                targets.append(
                    TargetStats(
                        target_id=str(target_id),
                        name=str(target_id),
                        passed=t_passed,
                        failed=t_failed,
                        avg_latency=avg_latency,
                        total_cost=t_cost,
                    )
                )

        overall_total = total_passed + total_failed
        pass_rate = (total_passed / overall_total * 100.0) if overall_total > 0 else 0.0

        duration = 0
        if "duration_ms" in flat.columns:
            dur_all = pd.to_numeric(flat["duration_ms"], errors="coerce").dropna()
            if not dur_all.empty:
                duration = int(dur_all.sum())

        total_cost = 0.0
        if "cost" in flat.columns:
            cost_all = pd.to_numeric(flat["cost"], errors="coerce").dropna()
            if not cost_all.empty:
                total_cost = float(cost_all.sum())

        # Count rows whose target/loop execution errored out (non-null error column).
        # These are execution failures distinct from evaluator failures — CI must
        # treat them as failures too, not just evaluator mismatches.
        failed_cells = 0
        if "error" in flat.columns:
            failed_cells = int(flat["error"].notna().sum())

        summary = ExperimentRunSummary(
            run_id=self.run_id,
            total_cells=len(flat),
            completed_cells=len(flat) - failed_cells,
            failed_cells=failed_cells,
            duration=duration,
            run_url=run_url,
            targets=targets,
            evaluators=evaluators,
            total_passed=total_passed,
            total_failed=total_failed,
            pass_rate=pass_rate,
            total_cost=total_cost,
        )

        has_failures = total_failed > 0 or failed_cells > 0
        return ExperimentRunResult(
            run_id=self.run_id,
            status="failed" if has_failures else "completed",
            passed=total_passed,
            failed=total_failed,
            pass_rate=pass_rate,
            duration=duration,
            run_url=run_url,
            summary=summary,
        )

    def __repr__(self) -> str:
        status = "finished" if self._finished else "running" if self.initialized else "not started"
        parts = [f"Experiment(name={self.name!r}, status={status}"]
        if self.initialized:
            parts.append(f"run_id={self.run_id!r}")
        if self.total > 0:
            parts.append(f"progress={self.progress}/{self.total}")
        parts_str = ", ".join(parts)
        return parts_str + ")"

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
            if _is_dataframe(iterable):
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
                self._finished = True

                # Auto-fetch and display results after completion
                self._auto_display_results()

        except Exception as e:
            self._finished = True
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

    async def aloop(
        self,
        iterable: Union[Iterable[ItemT], pd.DataFrame],
        *,
        concurrency: int = 4,
        total: Optional[int] = None,
    ):
        """Async-native sibling of ``loop()``.

        All submitted work runs on the caller's event loop, so loop-bound singletons
        (gRPC channels, Firestore clients, ADK InMemoryRunner, etc.) stay usable
        across items. Use together with :meth:`asubmit` to schedule per-item work.

        Cleanup is guaranteed on normal completion and when the caller breaks out
        of the ``async for`` **and** explicitly calls ``aclose()`` on the generator.
        Python's ``async for`` does not auto-close iterators on ``break``, so for
        deterministic cancellation of in-flight ``asubmit`` tasks, hold the
        generator in a variable and ``await generator.aclose()`` after the
        early exit. If you iterate to completion the finally block runs on the
        last ``__anext__`` automatically and no extra call is needed.
        """
        if concurrency < 1:
            raise ValueError(
                f"concurrency must be >= 1, got {concurrency!r}"
            )
        if not self.initialized:
            # init() does a blocking httpx.post — run it off-loop.
            await asyncio.to_thread(self.init)

        progress_bar: Optional[tqdm] = None
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

            if _is_dataframe(iterable):
                iterable = cast(Iterable[ItemT], iterable.iterrows())  # type: ignore

            self._async_semaphore = asyncio.Semaphore(concurrency)
            self._async_tasks = []

            for index, item in enumerate(iterable):
                self._current_index = index
                self._current_item = item

                with self._execute_item_iteration(index, item, in_thread=False):
                    yield item
                if len(self._async_tasks) == 0 and len(self._futures) == 0:
                    progress_bar.update(1)

            if len(self._async_tasks) > 0:
                for coro in asyncio.as_completed(self._async_tasks):
                    try:
                        await coro
                    except Exception:
                        # Per-item errors are already recorded via
                        # _execute_item_iteration; swallow so siblings finish.
                        pass
                    progress_bar.update(1)

            await self._await_completion()
            self._finished = True
            # _auto_display_results sleeps for several seconds and issues
            # synchronous HTTP — keep it off the event loop.
            await asyncio.to_thread(self._auto_display_results)

        except Exception as e:
            self._finished = True
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
        finally:
            # Guarantee cleanup on normal completion, early `break`, or
            # exception. Without this, a consumer that breaks out of `async
            # for` leaves _async_semaphore dangling (stale asubmit calls),
            # background tasks running, and the tqdm bar open.
            pending = [t for t in self._async_tasks if not t.done()]
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
            self._async_tasks = []
            self._async_semaphore = None
            if progress_bar is not None:
                progress_bar.close()

    def asubmit(
        self, func: Callable[..., Any], /, *args: Any, **kwargs: Any
    ) -> "asyncio.Task[Any]":
        """Async-native sibling of :meth:`submit`.

        Captures the current loop iteration's index/item, enters the per-item
        iteration context inside the spawned task, then awaits ``func``. Sync
        callables are offloaded to ``asyncio.to_thread`` so they do not block the
        event loop for concurrent async siblings.
        """
        if self._async_semaphore is None:
            raise RuntimeError(
                "asubmit() must be called from inside an `async for item in "
                "experiment.aloop(...):` block"
            )
        _current_index = self._current_index
        _current_item = self._current_item
        semaphore = self._async_semaphore

        async def wrapper() -> Any:
            async with semaphore:
                with self._execute_item_iteration(
                    _current_index, _current_item, in_thread=True
                ):
                    if asyncio.iscoroutinefunction(func):
                        return await func(*args, **kwargs)
                    return await asyncio.to_thread(func, *args, **kwargs)

        task = asyncio.create_task(wrapper())
        self._async_tasks.append(task)
        return task

    async def _await_completion(self) -> None:
        """Async-mode counterpart of ``_wait_for_completion``.

        Sends any remaining batch and joins fire-and-forget batch-sender threads
        without nesting ``asyncio.run`` inside a running loop.
        """
        self._send_batch(finished=True)
        for thread in self.threads:
            await asyncio.to_thread(thread.join)

    @contextmanager
    def _execute_item_iteration(
        self,
        index: int,
        item: Any,
        in_thread: bool = False,
    ) -> Iterator[Any]:
        # Reset with_target tracking for this iteration
        self._current_iteration_used_with_target = False

        # Set iteration context (thread-safe via contextvars).
        # `started_at` lets implicit-target paths (log_response) compute a
        # real duration instead of reporting 0.
        iter_ctx = IterationContext(
            index=index, item=item, started_at=time.time()
        )
        iter_token = _iteration_context.set(iter_ctx)

        # Reset target context at the start of each iteration to prevent pollution
        # from previous iterations (especially important for implicit Output targets)
        _target_context.set(None)

        # Determine if we should create an iteration trace:
        # - Don't create if evaluation uses targets (each target creates its own trace)
        # - Don't create if we're collecting submit() / asubmit() calls (not in_thread yet)
        has_pending_submissions = (
            len(self._futures) > 0 or len(self._async_tasks) > 0
        )
        should_create_iteration_trace = (
            not self._evaluation_uses_targets
            and (in_thread or not has_pending_submissions)
        )

        iteration: Optional[IterationInfo] = None
        _active_trace_token: Optional[Token[Optional[Any]]] = None
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
            if iteration["trace"].root_span:
                iteration["trace"].root_span.set_attributes(
                    {"langwatch.origin": "evaluation"}
                )
            # Store for target() to potentially close early — in the current
            # (per-task) contextvar copy so sibling tasks don't see it.
            _active_trace_token = _active_iteration_trace_ctx.set(
                iteration["trace"]
            )

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
            # Reset target context to prevent pollution to next iteration
            _target_context.set(None)

        # Handle iteration trace cleanup
        # Note: If target() was used, it may have already closed the trace
        if iteration is not None and not self._evaluation_uses_targets:
            try:
                iteration["duration"] = int((time.time() - start_time) * 1000)

                # If we just started the parallel loop, we need to skip the first iteration
                # from being added to the batch and change the trace name
                if not in_thread and (
                    len(self._futures) > 0 or len(self._async_tasks) > 0
                ):
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
                # Only exit the trace if target()/log_response() didn't close
                # it early (which resets the contextvar to None as its
                # signal). If still active, close it here.
                if _active_iteration_trace_ctx.get() is iteration["trace"]:
                    iteration["trace"].__exit__(None, None, None)

        # Clear active iteration trace reference for this task's context.
        if _active_trace_token is not None:
            try:
                _active_iteration_trace_ctx.reset(_active_trace_token)
            except (LookupError, ValueError):
                # Swallowed intentionally: `_active_trace_token` is created
                # via `set()` in the same asyncio task, so `reset()` should
                # always succeed. But if Python GCs an async generator in a
                # different task's context during teardown, the token can
                # look "from a different Context" and raise ValueError —
                # that's a cleanup edge case, not a user-visible failure,
                # so we don't let it mask the real iteration result.
                pass

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
                        else _scalar_or_json_entry(iteration["item"])
                    )
                )
            )
        )
        batch_entry = BatchEntry(
            index=iteration["index"],
            entry=entry,
            duration=iteration["duration"],
            error=str(iteration["error"]) if iteration["error"] else None,
            trace_id=iteration["trace"].trace_id or "",
        )
        with self.lock:
            self.batch["dataset"].append(batch_entry)

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
                **build_auth_headers(api_key),
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
        # Close the active iteration trace early — per-task via contextvar so
        # we only touch the trace belonging to the task calling target().
        active_trace = _active_iteration_trace_ctx.get()
        if active_trace is not None:
            active_trace.__exit__(None, None, None)
            _active_iteration_trace_ctx.set(None)

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

            tracer = trace.get_tracer("langwatch")

            # Start a new root span with no parent by passing an empty context
            # This ensures each target gets a unique trace_id
            root_context = otel_context.Context()

            with tracer.start_as_current_span(
                f"evaluation.target.{name}",
                context=root_context,
                attributes={
                    "langwatch.origin": "evaluation",
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
                            else _scalar_or_json_entry(current_item)
                        )
                    )
                )
            )

            # Get predicted output from context (set via log_response())
            predicted = ctx.predicted

            # Keep the output addressable by compare() after the batch that
            # carries it has been flushed, and add the duration only this
            # block knows.
            self._record_row_output(
                index=index,
                target=name,
                predicted=predicted,
                duration_ms=duration_ms,
            )

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

        Can be called inside a `target()` context, or outside of one. When called
        outside a target context, an implicit "Output" target is created automatically.
        The response will be stored in the dataset entry's `predicted` field, which
        is displayed in the results table.

        Args:
            response: The model's output. Can be a string (will be wrapped as
                     {"output": response}) or a dict with named outputs.

        Example:
            ```python
            # With explicit target
            with evaluation.target("gpt-4", {"model": "openai/gpt-4"}):
                response = call_gpt4(row["question"])
                evaluation.log_response(response)  # Store the output
                evaluation.log("quality", index=index, score=0.95)  # Log metrics

            # Without explicit target (creates implicit "Output" target)
            for index, row in evaluation.loop(df.iterrows()):
                response = my_model(row["question"])
                evaluation.log_response(response)  # Creates "Output" target
                evaluation.log("quality", index=index, score=0.95)
            ```
        """
        ctx = _target_context.get()

        # Normalize response to dict format
        if isinstance(response, str):
            predicted = {"output": response}
        elif isinstance(response, dict):
            predicted = response
        else:
            # Try to convert to string for other types
            predicted = {"output": str(response)}

        if ctx is None:
            # Create implicit "Output" target and dataset entry immediately
            self._create_implicit_output_target(predicted)
        else:
            # Inside explicit target context - just set predicted
            ctx.predicted = predicted
            self._record_row_output(
                index=ctx.index, target=ctx.target_id, predicted=predicted
            )

    def _create_implicit_output_target(self, predicted: Dict[str, Any]) -> None:
        """
        Create an implicit "Output" target when log_response() is called outside
        a target() context. This enables a simpler API for single-target evaluations.

        Creates the dataset entry immediately with the predicted response.
        """
        target_name = "Output"

        # Mark that targets are being used
        if not self._evaluation_uses_targets:
            self._evaluation_uses_targets = True

        # If an iteration trace is still open for this task, reuse its
        # trace_id so the dataset row points at the trace that actually
        # contains the ADK / OpenAI / LangChain instrumentor spans recorded
        # during the iteration. Capture the id BEFORE closing, then close.
        trace_id: Optional[str] = None
        active_trace = _active_iteration_trace_ctx.get()
        if active_trace is not None:
            try:
                root_span = getattr(active_trace, "root_span", None)
                otel_span = (
                    getattr(root_span, "_span", None)
                    if root_span is not None
                    else None
                )
                if otel_span is not None:
                    sc = otel_span.get_span_context()
                    if sc and sc.trace_id:
                        trace_id = format(sc.trace_id, "032x")
            except Exception:
                trace_id = None
            active_trace.__exit__(None, None, None)
            _active_iteration_trace_ctx.set(None)

        self._current_iteration_used_with_target = True

        # Register the target
        self._register_target(target_name, None)

        # Get index and item from iteration context
        iter_ctx = _iteration_context.get()
        if iter_ctx is not None:
            index = iter_ctx.index
            current_item = iter_ctx.item
            iter_started_at = iter_ctx.started_at
        else:
            index = self._current_index
            current_item = self._current_item
            iter_started_at = 0.0

        # Fallback: if we didn't capture a trace id from the iteration trace
        # (e.g. log_response() was called outside an aloop/loop), open a
        # fresh root trace so we still record *something* addressable.
        if trace_id is None:
            tracer = trace.get_tracer("langwatch")
            root_context = otel_context.Context()
            with tracer.start_span(
                f"evaluation.target.{target_name}",
                context=root_context,
                attributes={
                    "langwatch.origin": "evaluation",
                    "evaluation.run_id": self.run_id,
                    "evaluation.index": index,
                    "evaluation.target": target_name,
                },
            ) as span:
                span_context = span.get_span_context()
                trace_id = format(span_context.trace_id, "032x")

        # Create and set target context (for subsequent log() calls)
        ctx = TargetContext(
            target_id=target_name,
            index=index,
            trace_id=trace_id,
            predicted=predicted,
        )
        _target_context.set(ctx)

        # Create dataset entry immediately
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
                        else _scalar_or_json_entry(current_item)
                    )
                )
            )
        )

        # Duration from iteration start (set in _execute_item_iteration) to
        # this log_response() call. Falls back to 0 if we somehow have no
        # iteration context (shouldn't happen in normal flow).
        duration_ms = (
            int((time.time() - iter_started_at) * 1000)
            if iter_started_at
            else 0
        )
        batch_entry = BatchEntry(
            index=index,
            entry=entry_data,
            duration=duration_ms,
            error=None,
            trace_id=trace_id,
            target_id=target_name,
            predicted=predicted,
        )

        with self.lock:
            self.batch["dataset"].append(batch_entry)

        self._record_row_output(
            index=index,
            target=target_name,
            predicted=predicted,
            duration_ms=duration_ms,
        )

    def _record_row_output(
        self,
        *,
        index: int,
        target: str,
        predicted: Optional[Dict[str, Any]] = None,
        duration_ms: Optional[int] = None,
    ) -> None:
        """Remember what a target produced for a row, for compare() to read.

        Called from every place an output is recorded, and merges with what
        is already there: log_response() knows the output, target() knows how
        long producing it took, and either can arrive first.

        A target that produced nothing is not kept: it has no output to
        judge, so it is not a candidate.
        """
        output = _predicted_as_text(predicted)
        duration = duration_ms / 1000.0 if duration_ms is not None else None

        with self._row_outputs_lock:
            row = self._row_outputs.get(index)
            previous = row.get(target) if row is not None else None
            if not output and previous is None:
                return
            if row is None:
                row = {}
                self._row_outputs[index] = row
            self._row_outputs.move_to_end(index)
            row[target] = _RecordedOutput(
                output=output or (previous.output if previous else ""),
                duration=(
                    duration
                    if duration is not None
                    else (previous.duration if previous else None)
                ),
            )
            while len(self._row_outputs) > _MAX_TRACKED_OUTPUT_ROWS:
                self._row_outputs.popitem(last=False)

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
        trace_id = ctx.trace_id if ctx else _current_trace_id()

        self._record_evaluation(
            name=metric,
            evaluator=metric,
            index=index_,
            trace_id=trace_id,
            target_id=target_id,
            data=data,
            score=score,
            passed=passed,
            label=label,
            details=details,
            status=status,
            duration=duration,
            cost=cost.amount if cost else None,
            error=error,
        )

    def _record_evaluation(
        self,
        *,
        name: str,
        evaluator: str,
        index: int,
        trace_id: str,
        data: Dict[str, Any],
        target_id: Optional[str] = None,
        score: Optional[float] = None,
        passed: Optional[bool] = None,
        label: Optional[str] = None,
        details: Optional[str] = None,
        status: Literal["processed", "error", "skipped"] = "processed",
        duration: Optional[int] = None,
        cost: Optional[float] = None,
        error: Optional[Exception] = None,
    ) -> None:
        """Add one evaluation result to the batch.

        The single place an evaluation entry is built, so a result graded
        against a target and one graded against the row itself cannot drift
        apart. The caller decides which it is: ``target_id=None`` records the
        result against the row, with no target attached.
        """
        eval = EvaluationResult(
            trace_id=trace_id,
            name=name,
            evaluator=evaluator,
            status=status if status else "error" if error else "processed",
            data=data,
            score=score,
            passed=passed,
            index=index,
            label=label,
            cost=cost,
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

    def compare(
        self,
        index: Union[int, Hashable],
        *,
        name: str = "comparison",
        targets: Optional[Sequence[str]] = None,
        input: Optional[str] = None,
        golden: Optional[str] = None,
        prompt: Optional[str] = None,
        model: Optional[str] = None,
        allow_tie: Optional[bool] = None,
        randomize_order: Optional[bool] = None,
        swap_and_reconcile: Optional[bool] = None,
        include_metrics: Optional[Sequence[Literal["duration"]]] = None,
        temperature: Optional[float] = None,
    ) -> ComparisonVerdict:
        """
        Judge a row's target outputs against each other and pick the best.

        Every target that recorded a non-empty output for the row is a
        candidate, judged together in a single call. The verdict grades no
        single target, so it is recorded against the row itself.

        A row with fewer than two outputs cannot be compared, so no judge is
        called: the row is recorded as skipped and a skipped verdict is
        returned, leaving the rest of the run to continue. A judge that fails
        or cannot be reached does not raise either, it comes back as an error
        verdict, so one bad row never ends a loop over many.

        Every option left unset is absent from the request, so the judge's
        own default applies. That includes the judge prompt, whose shipped
        default adapts per row to whether the row carries a reference answer
        and task context.

        Args:
            index: The row to compare, taken the way log() takes it: named
                   explicitly, since loop() hands the row index straight to
                   you. Also seeds the judge's deterministic candidate
                   shuffle, so the same row is always presented in the same
                   order.
            name: Display name for the comparison column.
            targets: Restrict the comparison to these targets. Naming a
                     target that recorded no output for the row is an error.
                     Defaults to every target that recorded one.
            input: Task context for the judge to weigh the candidates
                   against. Defaults to no task context.
            golden: Reference answer to compare each candidate against. Also
                    turns on golden judging, so this is the only knob to set.
                    Defaults to judging the candidates on their own merits.
            prompt: Judge prompt template, used verbatim. Placeholders:
                    {input}, {golden}, {candidates}. Defaults server-side to
                    the shipped prompt matching what the row provides.
            model: Judge model. Defaults server-side to the platform's
                   configured judge model.
            allow_tie: Let the judge answer "tie" when no candidate is
                       clearly better. Defaults to True server-side.
            randomize_order: Shuffle candidate order per row to counter
                             position bias. Defaults to True server-side.
            swap_and_reconcile: Judge each row a second time with the
                                candidate order reversed, and establish no
                                winner when the two disagree. Defaults to
                                True server-side.
            include_metrics: Per-candidate metrics to show the judge, so it
                             can prefer a faster candidate when quality is
                             comparable. Defaults to none server-side, and a
                             metric is only shown for candidates whose value
                             was recorded. Cost is not on offer: the platform
                             works a target's cost out from its traces after
                             the run, so there is none to show at the moment
                             a verdict is asked for.
            temperature: Judge sampling temperature. Defaults to 0.0
                         server-side.

        Returns:
            A ComparisonVerdict naming the winning target, or explaining why
            there is none.

        Example:
            ```python
            for index, row in experiment.loop(df.iterrows()):
                with experiment.target("gpt-5-mini"):
                    experiment.log_response(call_gpt(row["question"]))

                with experiment.target("claude-sonnet-5"):
                    experiment.log_response(call_claude(row["question"]))

                verdict = experiment.compare(index, input=row["question"])
                print(verdict.winner, verdict.reasoning)
            ```
        """
        prepared = self._prepare_comparison(
            index=index,
            name=name,
            targets=targets,
            input=input,
            golden=golden,
            prompt=prompt,
            model=model,
            allow_tie=allow_tie,
            randomize_order=randomize_order,
            swap_and_reconcile=swap_and_reconcile,
            include_metrics=include_metrics,
            temperature=temperature,
        )
        if isinstance(prepared, ComparisonVerdict):
            return prepared

        start_time = time.time()
        result = langwatch.evaluation.evaluate(
            slug=COMPARISON_EVALUATOR,
            name=prepared.name,
            data=prepared.data,
            settings=prepared.settings,
        )
        duration = int((time.time() - start_time) * 1000)

        return self._record_comparison(prepared, result, duration)

    async def acompare(
        self,
        index: Union[int, Hashable],
        *,
        name: str = "comparison",
        targets: Optional[Sequence[str]] = None,
        input: Optional[str] = None,
        golden: Optional[str] = None,
        prompt: Optional[str] = None,
        model: Optional[str] = None,
        allow_tie: Optional[bool] = None,
        randomize_order: Optional[bool] = None,
        swap_and_reconcile: Optional[bool] = None,
        include_metrics: Optional[Sequence[Literal["duration"]]] = None,
        temperature: Optional[float] = None,
    ) -> ComparisonVerdict:
        """Async-native sibling of :meth:`compare`.

        Awaits the judge instead of blocking on it, so a comparison inside an
        ``aloop`` / ``asubmit`` block leaves the event loop free for its
        concurrent siblings. Takes the same options and records the verdict
        the same way.
        """
        prepared = self._prepare_comparison(
            index=index,
            name=name,
            targets=targets,
            input=input,
            golden=golden,
            prompt=prompt,
            model=model,
            allow_tie=allow_tie,
            randomize_order=randomize_order,
            swap_and_reconcile=swap_and_reconcile,
            include_metrics=include_metrics,
            temperature=temperature,
        )
        if isinstance(prepared, ComparisonVerdict):
            return prepared

        start_time = time.time()
        result = await langwatch.evaluation.async_evaluate(
            slug=COMPARISON_EVALUATOR,
            name=prepared.name,
            data=prepared.data,
            settings=prepared.settings,
        )
        duration = int((time.time() - start_time) * 1000)

        return self._record_comparison(prepared, result, duration)

    def _prepare_comparison(
        self,
        *,
        index: Union[int, Hashable],
        name: str,
        targets: Optional[Sequence[str]],
        input: Optional[str],
        golden: Optional[str],
        prompt: Optional[str],
        model: Optional[str],
        allow_tie: Optional[bool],
        randomize_order: Optional[bool],
        swap_and_reconcile: Optional[bool],
        include_metrics: Optional[Sequence[Literal["duration"]]],
        temperature: Optional[float],
    ) -> Union[_ComparisonRequest, ComparisonVerdict]:
        """Build the judge call for a row, or the verdict that replaces it.

        Returns a verdict directly when the row has fewer than two outputs:
        there is nothing for a judge to compare, and the row is recorded as
        skipped rather than failing the run.

        Every option the caller left unset is left out of the request, so the
        judge is the only place its default is written down.
        """
        try:
            index_ = int(cast(Any, index))
        except Exception:
            raise ValueError(f"Index must be an integer, got {index}")

        with self.lock:
            registered = list(self._targets.keys())
        with self._row_outputs_lock:
            recorded = dict(self._row_outputs.get(index_, {}))

        def has_output(target: str) -> bool:
            return bool(recorded.get(target) and recorded[target].output)

        requested: Optional[List[str]] = (
            None if targets is None else list(dict.fromkeys(targets))
        )

        if requested is None:
            candidates = [target for target in registered if has_output(target)]
        else:
            without_output = [
                target for target in requested if not has_output(target)
            ]
            if without_output:
                named = ", ".join(f"'{target}'" for target in without_output)
                raise ValueError(
                    f"Cannot compare row {index_}: no output was recorded for "
                    f"{named}. Compare a row once every target() block for it "
                    f"has closed."
                )
            candidates = [target for target in registered if target in requested]
            candidates += [
                target for target in requested if target not in candidates
            ]

        if len(candidates) < 2:
            missing = [
                target
                for target in registered
                if target not in candidates
                and (requested is None or target in requested)
            ]
            details = (
                f"A comparison needs at least two candidate outputs, this row "
                f"has {len(candidates)}."
            )
            if missing:
                details += f" No output was recorded for: {', '.join(missing)}."
            verdict = ComparisonVerdict(
                status="skipped",
                winner=None,
                reasoning=details,
                candidates=candidates,
            )
            self._record_evaluation(
                name=name,
                evaluator=COMPARISON_EVALUATOR,
                index=index_,
                trace_id=_current_trace_id(),
                data={"candidates": [{"id": target} for target in candidates]},
                status=_COMPARISON_ENTRY_STATUS[verdict.status],
                details=details,
            )
            return verdict

        candidate_payloads: List[Dict[str, Any]] = []
        for target in candidates:
            output = recorded[target]
            payload: Dict[str, Any] = {"id": target, "output": output.output}
            if output.duration is not None:
                payload["duration"] = output.duration
            candidate_payloads.append(payload)

        data: Dict[str, Any] = {}
        if input is not None:
            data["input"] = input
        if golden is not None:
            data["golden"] = golden
        data["candidates"] = candidate_payloads
        # Seeds the judge's deterministic shuffle, so the caller never has to
        # repeat a row index we already know.
        data["row_index"] = index_

        settings: Dict[str, Any] = {}
        if prompt is not None:
            settings["prompt"] = prompt
        if model is not None:
            settings["model"] = model
        if golden is not None:
            # One knob, not two. Passing a reference answer and separately
            # declaring that one exists is a footgun: forget the second and
            # the judge silently ignores the first.
            settings["has_golden_answer"] = True
        if allow_tie is not None:
            settings["allow_tie"] = allow_tie
        if randomize_order is not None:
            settings["randomize_order"] = randomize_order
        if swap_and_reconcile is not None:
            settings["swap_and_reconcile"] = swap_and_reconcile
        if include_metrics is not None:
            settings["include_metrics"] = list(include_metrics)
        if temperature is not None:
            settings["temperature"] = temperature

        return _ComparisonRequest(
            index=index_,
            name=name,
            candidates=candidates,
            data=data,
            settings=settings,
        )

    def _record_comparison(
        self,
        request: _ComparisonRequest,
        result: EvaluationResultModel,
        duration: int,
    ) -> ComparisonVerdict:
        """Record a judge's answer against the row and return it as a verdict.

        The entry carries no target: a comparison grades no single candidate,
        and attaching it to one would make that candidate look independently
        graded. Its candidate ids are what the results page reads to render
        the row as a comparison.

        The verdict is decided first and the recorded status is read off it,
        so what the caller is handed and what the platform stores are always
        the same answer.
        """
        if result.status == "error":
            # The judge failed or was unreachable. That says nothing about
            # the candidates, so it is not inconclusive: inconclusive is a
            # finding about them, and this run made no finding at all.
            verdict_status: ComparisonStatus = "error"
            winner = None
        elif result.status == "processed" and result.label:
            decided = result.label != "tie"
            verdict_status = "decided" if decided else "tie"
            winner = result.label if decided else None
        else:
            # The judge reports a skip when its swap-and-reconcile passes
            # disagreed: the verdict did not survive reversing the candidate
            # order, so the candidates are too close to separate. Recording
            # that as a tie would claim they are equally good, which is a
            # measurement this row never made.
            verdict_status = "inconclusive"
            winner = None

        verdict = ComparisonVerdict(
            status=verdict_status,
            winner=winner,
            reasoning=result.details,
            candidates=list(request.candidates),
        )

        self._record_evaluation(
            name=request.name,
            evaluator=COMPARISON_EVALUATOR,
            index=request.index,
            trace_id=_current_trace_id(),
            data={"candidates": [{"id": target} for target in request.candidates]},
            status=_COMPARISON_ENTRY_STATUS[verdict.status],
            score=result.score,
            label=result.label,
            details=result.details,
            duration=duration,
            cost=result.cost.amount if result.cost else None,
        )

        return verdict

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
