"""
langwatch.workflow - Evaluate a studio workflow on the platform and get per-row results.

Runs a committed Optimization Studio workflow through the unified evaluations-v3
backend and returns the SAME :class:`~langwatch.experiment.platform_run.ExperimentRunResult`
an experiment run returns — including a lazy ``result.results`` per-row DataFrame.

```python
import langwatch

result = langwatch.workflow.run("workflow_abc123", data=[{"input": "hi"}])
result.print_summary()
result.results  # per-row DataFrame, same shape as experiment.run(...).results
```
"""

from typing import Any, Callable, Dict, List, Optional, Union
from urllib.parse import urlparse

import httpx

import langwatch
from langwatch.experiment.platform_run import (
    ExperimentRunResult,
    ExperimentsApiError,
    _build_run_body,
    _poll_until_complete,
    _replace_url_domain,
)
from langwatch.state import get_api_key, get_endpoint
from langwatch.utils.auth import build_auth_headers


def _experiment_slug_from_run_url(run_url: str) -> str:
    """Pull the experiment slug out of a workflow run URL.

    Workflow runs report a ``run_url`` shaped like
    ``https://app.langwatch.ai/<project>/experiments/<slug>?runId=...``.
    The slug is the path segment right after ``experiments``.
    """
    if not run_url:
        return ""
    path_segments = [seg for seg in urlparse(run_url).path.split("/") if seg]
    if "experiments" in path_segments:
        idx = path_segments.index("experiments")
        if idx + 1 < len(path_segments):
            return path_segments[idx + 1]
    return ""


def run(
    workflow_id: str,
    *,
    data: Optional[Union[List[dict], "pd.DataFrame"]] = None,
    dataset_id: Optional[str] = None,
    parameters: Optional[Dict[str, Any]] = None,
    version_id: Optional[str] = None,
    row_indices: Optional[List[int]] = None,
    poll_interval: float = 2.0,
    timeout: float = 600.0,
    on_progress: Optional[Callable[[int, int], None]] = None,
    api_key: Optional[str] = None,
) -> ExperimentRunResult:
    """
    Evaluate a committed studio workflow and wait for completion.

    Args:
        workflow_id: The id of the workflow to evaluate.
        data: Optional inline rows to evaluate. Accepts a list of dicts or a
            pandas DataFrame (converted with ``to_dict(orient="records")``).
            Mutually exclusive with ``dataset_id``.
        dataset_id: Optional id of a platform dataset to evaluate. Mutually
            exclusive with ``data``.
        parameters: Optional constants applied to every row.
        version_id: Optional specific workflow version to run (defaults to the
            latest committed version).
        row_indices: Optional subset of row indices to evaluate.
        poll_interval: Seconds between status checks (default: 2.0)
        timeout: Maximum seconds to wait for completion (default: 600.0)
        on_progress: Optional callback for progress updates (completed, total)
        api_key: Optional API key override (uses LANGWATCH_API_KEY env var by default)

    Returns:
        ExperimentRunResult with the same shape an experiment run returns. Access
        ``result.results`` for a per-row pandas DataFrame.

    Raises:
        ValueError: If both ``data`` and ``dataset_id`` are provided, if the
            workflow is unknown, or if it has no committed version / invalid inputs.
        ExperimentsApiError: For other API errors.

    Example:
        ```python
        import langwatch

        result = langwatch.workflow.run("workflow_abc123", data=[{"input": "hi"}])
        result.print_summary()
        result.results
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
    if version_id is not None:
        body["version_id"] = version_id

    start_response = _evaluate_workflow(
        workflow_id, endpoint, effective_api_key, body
    )
    run_id = start_response["run_id"]

    api_run_url = start_response.get("run_url", "")
    run_url = _replace_url_domain(api_run_url, endpoint) if api_run_url else ""
    experiment_slug = _experiment_slug_from_run_url(api_run_url)

    print(f"Started workflow run: {run_id}")
    if run_url:
        print(f"Follow live: {run_url}")

    return _poll_until_complete(
        run_id,
        endpoint,
        effective_api_key,
        run_url=run_url,
        total=0,
        poll_interval=poll_interval,
        timeout=timeout,
        on_progress=on_progress,
        experiment_slug=experiment_slug,
    )


def _evaluate_workflow(
    workflow_id: str, endpoint: str, api_key: str, body: Dict[str, Any]
) -> dict:
    """Kick off a workflow evaluation run."""
    with httpx.Client(timeout=60) as client:
        response = client.post(
            f"{endpoint}/api/workflows/{workflow_id}/evaluate",
            headers=build_auth_headers(api_key),
            json=body or None,
        )

    if response.status_code == 404:
        raise ValueError(f"Workflow not found: {workflow_id}")
    if response.status_code == 401:
        raise ExperimentsApiError("Unauthorized - check your API key", 401)
    if response.status_code == 400:
        error_body = response.json() if response.content else {}
        message = error_body.get("error") or error_body.get("message") or (
            "Workflow has no committed version or the inputs are invalid"
        )
        raise ValueError(message)
    if not response.is_success:
        error_body = response.json() if response.content else {}
        raise ExperimentsApiError(
            error_body.get(
                "error", f"Failed to start workflow evaluation: {response.status_code}"
            ),
            response.status_code,
        )

    return response.json()


__all__ = ["run"]
