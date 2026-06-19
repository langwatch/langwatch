"""Unit tests for server-side ``langwatch.experiment.run`` with per-row results.

These mock the HTTP boundary (``httpx.Client``) so we assert exactly what JSON body
the SDK posts to ``/api/evaluations/v3/{slug}/run`` and that ``result.results``
materializes the expected per-row DataFrame from the ``/results`` response.

Specs: specs/experiment/server_run_results.feature
"""

from typing import Any, Dict, List, Optional
from unittest.mock import patch

import pandas as pd
import pytest

from langwatch.experiment import platform_run
from langwatch.experiment.platform_run import run as experiment_run


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
    """Records every request and replays scripted responses by (method, path).

    ``post`` and ``get`` look up the suffix of the URL so tests stay agnostic
    about the endpoint host.
    """

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
    """Neutralize side effects: real setup, env credentials, and poll sleeps."""
    monkeypatch.setattr("langwatch.ensure_setup", lambda: None)
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
                "entry": {"question": "what is AI?"},
                "traceId": "trace_0",
                "duration": 1200,
                "cost": 0.002,
                "predicted": {"output": "AI is intelligence."},
            },
            {
                "index": 1,
                "entry": {"question": "what is ML?"},
                "traceId": "trace_1",
                "duration": 800,
                "predicted": {"output": "ML is learning."},
            },
        ],
        "evaluations": [
            {"index": 0, "name": "quality", "score": 0.95, "passed": True},
            {"index": 1, "name": "quality", "score": 0.40, "passed": False},
        ],
    }


def _script_full_run(*, total: int = 2):
    """Script start -> completed -> results so a run() call resolves end-to-end."""
    _FakeClient.post_responses = {
        "/run": _FakeResponse(
            200,
            {
                "runId": "run_123",
                "status": "running",
                "total": total,
                "runUrl": "https://app.langwatch.ai/proj/experiments/rag-eval?runId=run_123",
            },
        ),
    }
    _FakeClient.get_responses = {
        "/runs/run_123/results": _FakeResponse(200, _results_payload()),
        "/runs/run_123": _FakeResponse(
            200,
            {
                "status": "completed",
                "progress": total,
                "total": total,
                "summary": {
                    "totalCells": total,
                    "completedCells": total,
                    "failedCells": 0,
                    "duration": 2000,
                    "totalPassed": 1,
                    "totalFailed": 1,
                    "passRate": 50.0,
                },
            },
        ),
    }


class TestExperimentRunWithInlineData:
    """when running an experiment with inline data rows"""

    def test_posts_inline_data_and_returns_results_dataframe(self):
        _script_full_run()
        rows = [{"question": "what is AI?"}, {"question": "what is ML?"}]

        with patch.object(platform_run.httpx, "Client", _FakeClient):
            result = experiment_run("rag-eval", data=rows, poll_interval=0)

            # Body carries inline data and no dataset id.
            run_post = next(p for p in _FakeClient.captured_posts if "/run" in p["url"])
            assert run_post["json"] == {"data": rows}
            assert "dataset_id" not in run_post["json"]

            # run_url points at the experiment results page.
            assert "experiments/rag-eval" in result.run_url
            assert result.experiment_slug == "rag-eval"

            # results is a DataFrame with the expected per-row columns.
            df = result.results
            assert isinstance(df, pd.DataFrame)
            assert len(df) == 2
            assert "output" in df.columns
            assert "trace_id" in df.columns
            assert "quality" in df.columns
            assert "quality_passed" in df.columns
            assert df.loc[0, "quality"] == 0.95
            assert df.loc[0, "quality_passed"] == True  # noqa: E712
            assert df.loc[0, "output"] == "AI is intelligence."

    def test_results_request_includes_experiment_slug(self):
        _script_full_run()
        with patch.object(platform_run.httpx, "Client", _FakeClient):
            result = experiment_run("rag-eval", data=[{"q": "x"}], poll_interval=0)
            _ = result.results
            results_get = next(
                g for g in _FakeClient.captured_gets if "/results" in g["url"]
            )
            assert "experimentSlug=rag-eval" in results_get["url"]

    def test_results_are_cached_after_first_access(self):
        _script_full_run()
        with patch.object(platform_run.httpx, "Client", _FakeClient):
            result = experiment_run("rag-eval", data=[{"q": "x"}], poll_interval=0)
            _ = result.results
            _ = result.results
            results_calls = [
                g for g in _FakeClient.captured_gets if "/results" in g["url"]
            ]
            assert len(results_calls) == 1


class TestExperimentRunWithDataFrame:
    """when passing a pandas DataFrame as data"""

    def test_dataframe_is_converted_to_records(self):
        _script_full_run()
        frame = pd.DataFrame([{"question": "a"}, {"question": "b"}])

        with patch.object(platform_run.httpx, "Client", _FakeClient):
            experiment_run("rag-eval", data=frame, poll_interval=0)

        run_post = next(p for p in _FakeClient.captured_posts if "/run" in p["url"])
        assert run_post["json"] == {"data": [{"question": "a"}, {"question": "b"}]}


class TestExperimentRunWithDatasetId:
    """when running with a platform dataset id"""

    def test_posts_dataset_id_and_no_inline_data(self):
        _script_full_run()
        with patch.object(platform_run.httpx, "Client", _FakeClient):
            experiment_run("rag-eval", dataset_id="ds_abc", poll_interval=0)

        run_post = next(p for p in _FakeClient.captured_posts if "/run" in p["url"])
        assert run_post["json"] == {"dataset_id": "ds_abc"}
        assert "data" not in run_post["json"]


class TestExperimentRunWithParameters:
    """when running with parameters"""

    def test_parameters_are_sent_in_body(self):
        _script_full_run()
        with patch.object(platform_run.httpx, "Client", _FakeClient):
            experiment_run(
                "rag-eval", parameters={"model": "gpt-5-mini"}, poll_interval=0
            )

        run_post = next(p for p in _FakeClient.captured_posts if "/run" in p["url"])
        assert run_post["json"] == {"parameters": {"model": "gpt-5-mini"}}


class TestExperimentRunWithNoBody:
    """when running with no inline data, dataset, or parameters"""

    def test_sends_json_none_to_preserve_no_body_behavior(self):
        _script_full_run()
        with patch.object(platform_run.httpx, "Client", _FakeClient):
            experiment_run("rag-eval", poll_interval=0)

        run_post = next(p for p in _FakeClient.captured_posts if "/run" in p["url"])
        assert run_post["json"] is None


class TestExperimentRunValidation:
    """when both inline data and a dataset id are provided"""

    def test_raises_value_error_before_any_http_call(self):
        with patch.object(platform_run.httpx, "Client", _FakeClient):
            with pytest.raises(ValueError):
                experiment_run("rag-eval", data=[{"q": "x"}], dataset_id="ds_abc")

        # No HTTP call should have been made.
        assert _FakeClient.captured_posts == []


class TestExperimentRunResultsRetry:
    """when the results endpoint lags behind completion (rows not yet materialized)"""

    def test_retries_on_empty_results_until_rows_materialize(self):
        _FakeClient.post_responses = {
            "/run": _FakeResponse(
                200,
                {
                    "runId": "run_123",
                    "status": "running",
                    "total": 2,
                    "runUrl": "https://app.langwatch.ai/p/experiments/rag-eval?runId=run_123",
                },
            ),
        }
        status_payload = {
            "status": "completed",
            "progress": 2,
            "total": 2,
            "summary": {
                "totalCells": 2,
                "completedCells": 2,
                "failedCells": 0,
                "duration": 2000,
                "totalPassed": 2,
                "totalFailed": 0,
                "passRate": 100.0,
            },
        }
        results_calls = {"n": 0}

        class _LaggyClient(_FakeClient):
            def get(self, url, headers=None, **kwargs):
                type(self).captured_gets.append({"url": url, "headers": headers})
                if "/results" in url:
                    results_calls["n"] += 1
                    # First read: completed run but rows not materialized yet.
                    if results_calls["n"] == 1:
                        return _FakeResponse(
                            200, {"dataset": [], "evaluations": [], "total": 2}
                        )
                    return _FakeResponse(200, _results_payload())
                return _FakeResponse(200, status_payload)

        with patch.object(platform_run.httpx, "Client", _LaggyClient):
            result = experiment_run("rag-eval", data=[{"q": "x"}], poll_interval=0)
            df = result.results
            assert len(df) == 2
            # The empty read was retried instead of cached.
            assert results_calls["n"] == 2
