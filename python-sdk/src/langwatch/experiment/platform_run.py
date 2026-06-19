"""
Runner for platform-configured experiments (Experiments Workbench).

This module provides the `run()` function to execute evaluations that are
configured in the LangWatch platform from CI/CD pipelines or scripts.
"""

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Literal, Optional, Union
from urllib.parse import quote, urlparse, urlunparse
import sys
import time
import httpx

import langwatch
from langwatch.experiment._results_df import build_results_df
from langwatch.state import get_api_key, get_endpoint
from langwatch.utils.auth import build_auth_headers

if TYPE_CHECKING:
    import pandas as pd


def _replace_url_domain(url: str, new_base: str) -> str:
    """Replace the domain/scheme of a URL with a new base URL, preserving the path."""
    if not url:
        return url

    parsed_url = urlparse(url)
    parsed_new_base = urlparse(new_base)

    # Replace scheme and netloc with new base, keep path/query/fragment
    return urlunparse((
        parsed_new_base.scheme,
        parsed_new_base.netloc,
        parsed_url.path,
        parsed_url.params,
        parsed_url.query,
        parsed_url.fragment,
    ))


class ExperimentNotFoundError(Exception):
    """Raised when experiment slug doesn't exist."""

    def __init__(self, slug: str):
        self.slug = slug
        super().__init__(f"Evaluation not found: {slug}")


class ExperimentTimeoutError(Exception):
    """Raised when experiment run times out."""

    def __init__(self, run_id: str, progress: int, total: int):
        self.run_id = run_id
        self.progress = progress
        self.total = total
        super().__init__(
            f"Evaluation run timed out: {run_id} ({progress}/{total} completed)"
        )


class ExperimentRunFailedError(Exception):
    """Raised when experiment run fails."""

    def __init__(self, run_id: str, error: str):
        self.run_id = run_id
        self.error_message = error
        super().__init__(f"Evaluation run failed: {error}")


class ExperimentsApiError(Exception):
    """Raised for other API errors."""

    def __init__(self, message: str, status_code: int):
        self.status_code = status_code
        super().__init__(message)


@dataclass
class TargetStats:
    """Statistics for a single target."""

    target_id: str
    name: str
    passed: int
    failed: int
    avg_latency: float
    total_cost: float


@dataclass
class EvaluatorStats:
    """Statistics for a single evaluator."""

    evaluator_id: str
    name: str
    passed: int
    failed: int
    pass_rate: float
    avg_score: Optional[float] = None


@dataclass
class ExperimentRunSummary:
    """Summary of a completed experiment run."""

    run_id: str
    total_cells: int
    completed_cells: int
    failed_cells: int
    duration: int
    run_url: str = ""
    targets: List[TargetStats] = field(default_factory=list)
    evaluators: List[EvaluatorStats] = field(default_factory=list)
    total_passed: int = 0
    total_failed: int = 0
    pass_rate: float = 0.0
    total_cost: float = 0.0


@dataclass(repr=False)
class ExperimentRunResult:
    """Result of running a platform evaluation."""

    run_id: str
    status: Literal["completed", "failed", "stopped"]
    passed: int
    failed: int
    pass_rate: float
    duration: int
    run_url: str
    summary: ExperimentRunSummary
    experiment_slug: str = ""
    api_key: str = field(default="", repr=False)
    _cached_results_df: Optional["pd.DataFrame"] = field(
        default=None, repr=False, compare=False
    )

    @property
    def results(self) -> "pd.DataFrame":
        """
        Per-row evaluation results as a pandas DataFrame, fetched from the platform.

        Each row corresponds to one dataset entry (or one entry per target in
        multi-target runs). Columns include the input data, ``output``,
        ``trace_id``, ``duration_ms``, ``cost``, plus one column per evaluation
        metric and its ``<name>_passed`` companion.

        The platform is the single source of truth — costs are computed from
        traces, durations are accurate, and all data is consistent.

        Example::

            result = langwatch.experiment.run("my-experiment", data=[...])
            result.results                       # renders as table in Jupyter
            result.results["my_metric"].mean()   # aggregate a metric
        """
        if self._cached_results_df is not None:
            return self._cached_results_df

        df = self._fetch_results_as_df()
        self._cached_results_df = df
        return df

    def _fetch_results_as_df(
        self, retries: int = 5, delay: float = 3.0
    ) -> "pd.DataFrame":
        """Fetch per-row results from the platform and build a DataFrame.

        ClickHouse can lag for a moment right after a run completes, so we retry
        with a short backoff. On persistent failure we return an empty DataFrame
        rather than raising — the run already succeeded, only the read is late.
        """
        import pandas as pd

        endpoint = get_endpoint()
        api_key = self.api_key or get_api_key() or ""

        url = (
            f"{endpoint}/api/evaluations/v3/runs/"
            f"{quote(self.run_id)}/results"
            f"?experimentSlug={quote(self.experiment_slug)}"
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
                    payload = response.json()
                    df = build_results_df(payload)
                    # ClickHouse can lag: a completed run may briefly return 200
                    # with an empty dataset before its rows materialize. Retry on
                    # an empty result when the run reports rows, rather than
                    # caching the empty frame.
                    if (
                        df.empty
                        and (payload.get("total") or 0) > 0
                        and attempt < retries - 1
                    ):
                        time.sleep(delay)
                        continue
                    return df

            except Exception:
                if attempt < retries - 1:
                    time.sleep(delay)
                    continue

        return pd.DataFrame()

    def print_summary(self, exit_on_failure: Optional[bool] = None) -> None:
        """
        Print a CI-friendly summary and optionally exit with code 1 on failure.

        Args:
            exit_on_failure: If True, calls sys.exit(1) when there are failures.
                           If False, never exits.
                           If None (default), auto-detects: exits in scripts/CI, doesn't exit in notebooks.
        """
        _print_summary(self)

        # Auto-detect: don't exit in notebooks, exit in scripts/CI
        should_exit = exit_on_failure if exit_on_failure is not None else not _is_notebook()

        if should_exit and self.failed > 0:
            sys.exit(1)

    def __repr__(self) -> str:
        status_icon = {"completed": "OK", "failed": "FAIL", "stopped": "STOPPED"}.get(
            self.status, self.status
        )
        return (
            f"ExperimentRunResult("
            f"status={status_icon}, "
            f"passed={self.passed}, failed={self.failed}, "
            f"pass_rate={self.pass_rate:.1f}%, "
            f"duration={self.duration / 1000:.1f}s)"
        )

    def to_dataframe(self) -> "pd.DataFrame":
        """
        Convert the experiment run summary to a pandas DataFrame.

        Returns a DataFrame with one row per evaluator, showing pass rate,
        passed/failed counts, and average score.

        Example::

            result = langwatch.experiment.run("my-experiment")
            result.to_dataframe()          # renders as table in Jupyter
        """
        import pandas as pd

        rows = []
        for e in self.summary.evaluators:
            rows.append({
                "evaluator": e.name,
                "pass_rate": e.pass_rate,
                "passed": e.passed,
                "failed": e.failed,
                "avg_score": e.avg_score,
            })

        if not rows:
            # Fallback: single summary row
            rows.append({
                "evaluator": "(all)",
                "pass_rate": self.pass_rate,
                "passed": self.passed,
                "failed": self.failed,
            })

        return pd.DataFrame(rows)


def _is_notebook() -> bool:
    """Detect if running in a Jupyter notebook."""
    try:
        from IPython import get_ipython  # type: ignore

        shell = get_ipython().__class__.__name__
        if shell == "ZMQInteractiveShell":
            return True  # Jupyter notebook or qtconsole
        elif shell == "TerminalInteractiveShell":
            return False  # Terminal running IPython
        else:
            return False
    except (ImportError, AttributeError, NameError):
        return False


def run(
    slug: str,
    *,
    data: Optional[Union[List[dict], "pd.DataFrame"]] = None,
    dataset_id: Optional[str] = None,
    parameters: Optional[Dict[str, Any]] = None,
    row_indices: Optional[List[int]] = None,
    poll_interval: float = 2.0,
    timeout: float = 600.0,
    on_progress: Optional[Callable[[int, int], None]] = None,
    api_key: Optional[str] = None,
) -> ExperimentRunResult:
    """
    Run a platform-configured experiment and wait for completion.

    This runs an Experiment that you have configured in the LangWatch platform.
    The experiment will execute all targets and evaluators defined in the configuration.

    Args:
        slug: The slug of the experiment to run (found in the experiment URL)
        data: Optional inline rows to evaluate. Accepts a list of dicts or a
            pandas DataFrame (converted with ``to_dict(orient="records")``).
            Mutually exclusive with ``dataset_id``.
        dataset_id: Optional id of a platform dataset to evaluate. Mutually
            exclusive with ``data``.
        parameters: Optional constants applied to every row (e.g. ``{"model": ...}``).
        row_indices: Optional subset of row indices to evaluate.
        poll_interval: Seconds between status checks (default: 2.0)
        timeout: Maximum seconds to wait for completion (default: 600.0 = 10 minutes)
        on_progress: Optional callback for progress updates (completed, total)
        api_key: Optional API key override (uses LANGWATCH_API_KEY env var by default)

    Returns:
        ExperimentRunResult with pass rate and summary. Call result.print_summary()
        to display results and exit with code 1 on failure. Access ``result.results``
        for a per-row pandas DataFrame.

    Raises:
        ValueError: If both ``data`` and ``dataset_id`` are provided
        ExperimentNotFoundError: If the experiment slug doesn't exist
        ExperimentTimeoutError: If the experiment doesn't complete within timeout
        ExperimentRunFailedError: If the experiment fails
        ExperimentsApiError: For other API errors

    Example:
        ```python
        import langwatch

        result = langwatch.experiment.run("my-experiment-slug")
        result.print_summary()
        result.results  # per-row DataFrame
        ```
    """
    if data is not None and dataset_id is not None:
        raise ValueError(
            "Pass either `data` or `dataset_id`, not both — they are mutually exclusive."
        )

    langwatch.ensure_setup()

    effective_api_key = api_key or get_api_key()
    endpoint = get_endpoint()

    if not effective_api_key:
        raise ValueError(
            "API key not set. Set LANGWATCH_API_KEY environment variable or pass api_key parameter."
        )

    body = _build_run_body(
        data=data,
        dataset_id=dataset_id,
        parameters=parameters,
        row_indices=row_indices,
    )

    # Start the run
    start_response = _start_run(slug, endpoint, effective_api_key, body)
    run_id = start_response["runId"]
    total = start_response.get("total", 0)

    # Use the run URL from API but replace domain with configured endpoint
    api_run_url = start_response.get("runUrl", "")
    run_url = _replace_url_domain(api_run_url, endpoint) if api_run_url else ""

    print(f"Started experiment run: {run_id}")
    if run_url:
        print(f"Follow live: {run_url}")

    return _poll_until_complete(
        run_id,
        endpoint,
        effective_api_key,
        run_url=run_url,
        total=total,
        poll_interval=poll_interval,
        timeout=timeout,
        on_progress=on_progress,
        experiment_slug=slug,
    )


def _build_run_body(
    *,
    data: Optional[Union[List[dict], "pd.DataFrame"]] = None,
    dataset_id: Optional[str] = None,
    parameters: Optional[Dict[str, Any]] = None,
    row_indices: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """Assemble the JSON body for a run request, including only provided keys."""
    body: Dict[str, Any] = {}
    if data is not None:
        if hasattr(data, "to_dict"):
            body["data"] = data.to_dict(orient="records")  # type: ignore[union-attr]
        else:
            body["data"] = data
    if dataset_id is not None:
        body["dataset_id"] = dataset_id
    if parameters is not None:
        body["parameters"] = parameters
    if row_indices is not None:
        body["row_indices"] = row_indices
    return body


def _poll_until_complete(
    run_id: str,
    endpoint: str,
    api_key: str,
    *,
    run_url: str,
    total: int,
    poll_interval: float,
    timeout: float,
    on_progress: Optional[Callable[[int, int], None]],
    experiment_slug: str = "",
) -> ExperimentRunResult:
    """Poll a run to completion, rendering progress, and build the result.

    Shared by the experiment ``run()`` and the workflow ``run()`` entry points so
    both surface the same progress UX and the same ``ExperimentRunResult`` (with a
    lazy ``.results`` DataFrame).
    """
    # Track last progress for change detection
    last_progress = 0

    # Print initial progress
    if total > 0:
        print(f"Progress: 0/{total} (0%)", end="", flush=True)
    if on_progress:
        on_progress(0, total)

    start_time = time.time()
    while True:
        if time.time() - start_time > timeout:
            print()  # Newline after progress
            status = _get_run_status(run_id, endpoint, api_key)
            raise ExperimentTimeoutError(
                run_id, status.get("progress", 0), status.get("total", 0)
            )

        time.sleep(poll_interval)

        status = _get_run_status(run_id, endpoint, api_key)
        progress = status.get("progress", 0)
        total = status.get("total", total)

        # Update progress display if changed
        if progress != last_progress and total > 0:
            percentage = (progress / total) * 100
            # Use carriage return to overwrite the line
            print(f"\rProgress: {progress}/{total} ({percentage:.0f}%)", end="", flush=True)
            last_progress = progress

        if on_progress:
            on_progress(progress, total)

        run_status = status.get("status")

        if run_status == "completed":
            print()  # Newline after progress
            summary_data = status.get("summary", {})
            return _build_result(
                run_id, "completed", summary_data, run_url, experiment_slug, api_key
            )

        if run_status == "failed":
            print()  # Newline after progress
            raise ExperimentRunFailedError(
                run_id, status.get("error", "Unknown error")
            )

        if run_status == "stopped":
            print()  # Newline after progress
            summary_data = status.get("summary", {})
            return _build_result(
                run_id, "stopped", summary_data, run_url, experiment_slug, api_key
            )


def _start_run(
    slug: str, endpoint: str, api_key: str, body: Optional[Dict[str, Any]] = None
) -> dict:
    """Start an experiment run.

    ``body`` carries the optional inline data / dataset_id / parameters / row_indices.
    When empty we send ``json=None`` so the historical no-body request is preserved.
    """
    with httpx.Client(timeout=60) as client:
        response = client.post(
            f"{endpoint}/api/evaluations/v3/{slug}/run",
            headers=build_auth_headers(api_key),
            json=body or None,
        )

    if response.status_code == 404:
        raise ExperimentNotFoundError(slug)
    if response.status_code == 401:
        raise ExperimentsApiError("Unauthorized - check your API key", 401)
    if not response.is_success:
        error_body = response.json() if response.content else {}
        raise ExperimentsApiError(
            error_body.get("error", f"Failed to start evaluation: {response.status_code}"),
            response.status_code,
        )

    return response.json()


def _get_run_status(run_id: str, endpoint: str, api_key: str) -> dict:
    """Get the status of a run."""
    with httpx.Client(timeout=60) as client:
        response = client.get(
            f"{endpoint}/api/evaluations/v3/runs/{run_id}",
            headers=build_auth_headers(api_key),
        )

    if response.status_code == 404:
        raise ExperimentsApiError(f"Run not found: {run_id}", 404)
    if response.status_code == 401:
        raise ExperimentsApiError("Unauthorized - check your API key", 401)
    if not response.is_success:
        error_body = response.json() if response.content else {}
        raise ExperimentsApiError(
            error_body.get("error", f"Failed to get run status: {response.status_code}"),
            response.status_code,
        )

    return response.json()


def _build_result(
    run_id: str,
    status: Literal["completed", "failed", "stopped"],
    summary_data: dict,
    run_url: str,
    experiment_slug: str = "",
    api_key: str = "",
) -> ExperimentRunResult:
    """Build the result object from API response."""
    total_cells = summary_data.get("totalCells", 0)
    completed_cells = summary_data.get("completedCells", 0)
    failed_cells = summary_data.get("failedCells", 0)
    duration = summary_data.get("duration", 0)

    total_passed = summary_data.get("totalPassed", completed_cells - failed_cells)
    total_failed = summary_data.get("totalFailed", failed_cells)
    pass_rate = summary_data.get(
        "passRate",
        (total_passed / completed_cells * 100) if completed_cells > 0 else 0.0,
    )

    # Parse targets
    targets: List[TargetStats] = []
    for t in summary_data.get("targets", []):
        targets.append(
            TargetStats(
                target_id=t.get("targetId", ""),
                name=t.get("name", ""),
                passed=t.get("passed", 0),
                failed=t.get("failed", 0),
                avg_latency=t.get("avgLatency", 0),
                total_cost=t.get("totalCost", 0),
            )
        )

    # Parse evaluators
    evaluators: List[EvaluatorStats] = []
    for e in summary_data.get("evaluators", []):
        evaluators.append(
            EvaluatorStats(
                evaluator_id=e.get("evaluatorId", ""),
                name=e.get("name", ""),
                passed=e.get("passed", 0),
                failed=e.get("failed", 0),
                pass_rate=e.get("passRate", 0),
                avg_score=e.get("avgScore"),
            )
        )

    summary = ExperimentRunSummary(
        run_id=run_id,
        total_cells=total_cells,
        completed_cells=completed_cells,
        failed_cells=failed_cells,
        duration=duration,
        run_url=run_url,  # Always use the endpoint-based URL we constructed
        targets=targets,
        evaluators=evaluators,
        total_passed=total_passed,
        total_failed=total_failed,
        pass_rate=pass_rate,
        total_cost=summary_data.get("totalCost", 0),
    )

    return ExperimentRunResult(
        run_id=run_id,
        status=status,
        passed=total_passed,
        failed=total_failed,
        pass_rate=pass_rate,
        duration=duration,
        run_url=summary.run_url,
        summary=summary,
        experiment_slug=experiment_slug,
        api_key=api_key,
    )


def _print_summary(result: ExperimentRunResult) -> None:
    """Print a CI-friendly summary of the experiment results."""
    summary = result.summary

    print("\n" + "═" * 60)
    print("  EXPERIMENT RESULTS")
    print("═" * 60)
    print(f"  Run ID:     {result.run_id}")
    print(f"  Status:     {result.status.upper()}")
    print(f"  Duration:   {result.duration / 1000:.1f}s")
    print("─" * 60)
    print(f"  Passed:     {result.passed}")
    print(f"  Failed:     {result.failed}")
    print(f"  Pass Rate:  {result.pass_rate:.1f}%")
    if summary.total_cost:
        print(f"  Total Cost: ${summary.total_cost:.4f}")

    if summary.targets:
        print("─" * 60)
        print("  TARGETS:")
        for target in summary.targets:
            print(f"    {target.name}: {target.passed} passed, {target.failed} failed")
            if target.avg_latency:
                print(f"      Avg latency: {target.avg_latency:.0f}ms")
            if target.total_cost:
                print(f"      Total cost: ${target.total_cost:.4f}")

    if summary.evaluators:
        print("─" * 60)
        print("  EVALUATORS:")
        for evaluator in summary.evaluators:
            print(f"    {evaluator.name}: {evaluator.pass_rate:.1f}% pass rate")
            if evaluator.avg_score is not None:
                print(f"      Avg score: {evaluator.avg_score:.2f}")

    print("─" * 60)
    print(f"  View details: {result.run_url}")
    print("═" * 60 + "\n")


