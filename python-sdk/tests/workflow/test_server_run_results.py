"""Unit tests for server-side ``langwatch.workflow.run`` with per-row results.

These mock the HTTP boundary (``httpx.Client``) so we assert the SDK posts to
``/api/workflows/{workflow_id}/evaluate`` and that ``result.results`` builds the
SAME per-row DataFrame shape an experiment run returns.

Specs: specs/workflow/server_run_results.feature
"""

from typing import Any, Dict, List, Optional
from unittest.mock import patch

import pandas as pd
import pytest

from langwatch import workflow as workflow_module
from langwatch.experiment import platform_run
from langwatch.workflow import run as workflow_run


class _FakeResponse:
    def __init__(self, status_code: int, json_body: Optional[dict] = None):
        self.status_code = status_code
        self._json = json_body or {}
        self.content = b"{}"

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict:
        return self._json


class _FakeClient:
    """Records requests and replays scripted responses keyed by URL suffix."""

    captured_posts: List[Dict[str, Any]] = []
    captured_gets: List[Dict[str, Any]] = []
    post_responses: Dict[str, _FakeResponse] = {}
    get_responses: Dict[str, _FakeResponse] = {}

    def __init__(self, *args: Any, **kwargs: Any):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args: Any):
        return False

    @classmethod
    def reset(cls):
        cls.captured_posts = []
        cls.captured_gets = []
        cls.post_responses = {}
        cls.get_responses = {}

    def _match(self, url: str, table: Dict[str, _FakeResponse]) -> _FakeResponse:
        for suffix, resp in table.items():
            if suffix in url:
                return resp
        raise AssertionError(f"No scripted response for {url}")

    def post(self, url: str, headers=None, json=None, **kwargs: Any) -> _FakeResponse:
        type(self).captured_posts.append({"url": url, "json": json, "headers": headers})
        return self._match(url, type(self).post_responses)

    def get(self, url: str, headers=None, **kwargs: Any) -> _FakeResponse:
        type(self).captured_gets.append({"url": url, "headers": headers})
        return self._match(url, type(self).get_responses)


@pytest.fixture(autouse=True)
def _no_setup_no_sleep(monkeypatch):
    monkeypatch.setattr("langwatch.ensure_setup", lambda: None)
    monkeypatch.setattr(workflow_module, "get_api_key", lambda: "sk-lw-test")
    monkeypatch.setattr(
        workflow_module, "get_endpoint", lambda: "https://app.langwatch.ai"
    )
    # Both modules' get_endpoint/get_api_key are used (workflow for start,
    # platform_run for polling + results fetch).
    monkeypatch.setattr(platform_run, "get_api_key", lambda: "sk-lw-test")
    monkeypatch.setattr(
        platform_run, "get_endpoint", lambda: "https://app.langwatch.ai"
    )
    monkeypatch.setattr(platform_run.time, "sleep", lambda *_: None)
    _FakeClient.reset()
    yield
    _FakeClient.reset()


def _results_payload() -> dict:
    return {
        "dataset": [
            {
                "index": 0,
                "entry": {"input": "hi"},
                "traceId": "trace_0",
                "duration": 500,
                "predicted": {"output": "hello"},
            },
            {
                "index": 1,
                "entry": {"input": "bye"},
                "traceId": "trace_1",
                "duration": 600,
                "predicted": {"output": "goodbye"},
            },
        ],
        "evaluations": [
            {"index": 0, "name": "quality", "score": 0.9, "passed": True},
            {"index": 1, "name": "quality", "score": 0.8, "passed": True},
        ],
    }


def _script_full_run():
    _FakeClient.post_responses = {
        "/evaluate": _FakeResponse(
            200,
            {
                "run_id": "wfrun_1",
                "run_url": "https://app.langwatch.ai/proj/experiments/wf-slug?runId=wfrun_1",
                "workflow_version_id": "ver_1",
                "version": "1.0",
            },
        ),
    }
    _FakeClient.get_responses = {
        "/runs/wfrun_1/results": _FakeResponse(200, _results_payload()),
        "/runs/wfrun_1": _FakeResponse(
            200,
            {
                "status": "completed",
                "progress": 2,
                "total": 2,
                "summary": {
                    "totalCells": 2,
                    "completedCells": 2,
                    "failedCells": 0,
                    "duration": 1100,
                    "totalPassed": 2,
                    "totalFailed": 0,
                    "passRate": 100.0,
                },
            },
        ),
    }


class TestWorkflowRunWithInlineData:
    """when running a workflow with inline data rows"""

    def test_posts_to_evaluate_and_returns_same_dataframe_shape(self):
        _script_full_run()
        rows = [{"input": "hi"}, {"input": "bye"}]

        with patch.object(platform_run.httpx, "Client", _FakeClient), patch.object(
            workflow_module.httpx, "Client", _FakeClient
        ):
            result = workflow_run("workflow_abc", data=rows, poll_interval=0)

            # Posts to the workflow evaluate endpoint with inline data.
            evaluate_post = next(
                p for p in _FakeClient.captured_posts if "/evaluate" in p["url"]
            )
            assert "/api/workflows/workflow_abc/evaluate" in evaluate_post["url"]
            assert evaluate_post["json"] == {"data": rows}

            # run_url points at the workflow's experiment results page.
            assert "experiments/wf-slug" in result.run_url
            assert result.experiment_slug == "wf-slug"

            # Same per-row DataFrame shape an experiment run returns.
            df = result.results
            assert isinstance(df, pd.DataFrame)
            assert len(df) == 2
            assert "output" in df.columns
            assert "trace_id" in df.columns
            assert "quality" in df.columns
            assert "quality_passed" in df.columns
            assert df.loc[0, "output"] == "hello"
            assert df.loc[0, "quality"] == 0.9


class TestWorkflowRunWithDatasetId:
    """when running a workflow with a dataset id"""

    def test_posts_dataset_id_and_no_inline_data(self):
        _script_full_run()
        with patch.object(platform_run.httpx, "Client", _FakeClient), patch.object(
            workflow_module.httpx, "Client", _FakeClient
        ):
            workflow_run("workflow_abc", dataset_id="ds_xyz", poll_interval=0)

        evaluate_post = next(
            p for p in _FakeClient.captured_posts if "/evaluate" in p["url"]
        )
        assert evaluate_post["json"] == {"dataset_id": "ds_xyz"}


class TestWorkflowRunWithParameters:
    """when running a workflow with parameters"""

    def test_parameters_and_version_in_body(self):
        _script_full_run()
        with patch.object(platform_run.httpx, "Client", _FakeClient), patch.object(
            workflow_module.httpx, "Client", _FakeClient
        ):
            workflow_run(
                "workflow_abc",
                parameters={"feature_flag": "on"},
                version_id="ver_9",
                poll_interval=0,
            )

        evaluate_post = next(
            p for p in _FakeClient.captured_posts if "/evaluate" in p["url"]
        )
        assert evaluate_post["json"] == {
            "parameters": {"feature_flag": "on"},
            "version_id": "ver_9",
        }


class TestWorkflowRunValidation:
    """when both inline data and a dataset id are provided"""

    def test_raises_value_error_before_any_http_call(self):
        with patch.object(workflow_module.httpx, "Client", _FakeClient):
            with pytest.raises(ValueError):
                workflow_run("workflow_abc", data=[{"q": "x"}], dataset_id="ds_xyz")

        assert _FakeClient.captured_posts == []


class TestWorkflowRunErrors:
    """when the evaluate endpoint returns an error status"""

    def test_404_maps_to_workflow_not_found(self):
        _FakeClient.post_responses = {"/evaluate": _FakeResponse(404)}
        with patch.object(workflow_module.httpx, "Client", _FakeClient):
            with pytest.raises(ValueError) as exc:
                workflow_run("missing_wf", data=[{"q": "x"}], poll_interval=0)
        assert "missing_wf" in str(exc.value)

    def test_400_maps_to_clear_invalid_inputs_error(self):
        _FakeClient.post_responses = {
            "/evaluate": _FakeResponse(
                400, {"error": "Workflow has no committed version"}
            )
        }
        with patch.object(workflow_module.httpx, "Client", _FakeClient):
            with pytest.raises(ValueError) as exc:
                workflow_run("wf_uncommitted", data=[{"q": "x"}], poll_interval=0)
        assert "committed version" in str(exc.value)


class TestWorkflowSlugExtraction:
    """when deriving the experiment slug from the run url"""

    def test_extracts_slug_after_experiments_segment(self):
        url = "https://app.langwatch.ai/my-project/experiments/the-slug?runId=abc"
        assert workflow_module._experiment_slug_from_run_url(url) == "the-slug"

    def test_returns_empty_when_no_experiments_segment(self):
        assert workflow_module._experiment_slug_from_run_url("https://x/y/z") == ""
