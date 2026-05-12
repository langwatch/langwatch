import pytest
from fastapi.testclient import TestClient

from langwatch_nlp.studio.app import app
from langwatch_nlp.studio.types.events import (
    Error,
    ErrorPayload,
    ExecutionStateChange,
    ExecutionStateChangePayload,
)
from langwatch_nlp.studio.types.dsl import WorkflowExecutionState, ExecutionStatus


@pytest.fixture
def client():
    return TestClient(app)


# Minimal valid StudioClientEvent body — StopExecution requires only trace_id.
STOP_EXECUTION_BODY = {"type": "stop_execution", "payload": {"trace_id": "tid-test"}}


def make_stream(*events):
    """Return an async generator factory that matches execute_event_on_a_subprocess's signature."""

    async def _gen(*args, **kwargs):
        for event in events:
            yield event

    return _gen


def test_surfaces_error_event_message_from_stream(monkeypatch, client):
    """
    Regression test for issue #3161.

    When execute_event_on_a_subprocess yields an Error event (no ExecutionStateChange),
    execute_sync must surface the Error payload message rather than falling through to
    the generic "Execution completed without success or error status" message.
    """
    fake_stream = make_stream(
        Error(payload=ErrorPayload(message="boom: underlying failure detail"))
    )
    monkeypatch.setattr(
        "langwatch_nlp.studio.app.execute_event_on_a_subprocess", fake_stream
    )

    response = client.post("/execute_sync", json=STOP_EXECUTION_BODY)

    assert response.status_code == 500
    detail = response.json()["detail"]
    assert "boom: underlying failure detail" in detail
    assert "Execution completed without success or error status" not in detail


def test_returns_success_for_execution_state_change_success(monkeypatch, client):
    """
    When execute_event_on_a_subprocess yields an ExecutionStateChange with status=success,
    execute_sync returns 200 with trace_id, status, and the 'end' result.
    """
    execution_state = WorkflowExecutionState(
        status=ExecutionStatus.success,
        trace_id="tid-ok",
        result={"end": {"foo": "bar"}},
    )
    fake_stream = make_stream(
        ExecutionStateChange(
            payload=ExecutionStateChangePayload(execution_state=execution_state)
        )
    )
    monkeypatch.setattr(
        "langwatch_nlp.studio.app.execute_event_on_a_subprocess", fake_stream
    )

    response = client.post("/execute_sync", json=STOP_EXECUTION_BODY)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["trace_id"] == "tid-ok"
    assert body["result"] == {"foo": "bar"}


def test_returns_error_for_execution_state_change_error(monkeypatch, client):
    """
    When execute_event_on_a_subprocess yields an ExecutionStateChange with status=error,
    execute_sync returns 500 with the execution state error detail.
    """
    execution_state = WorkflowExecutionState(
        status=ExecutionStatus.error,
        error="state-change error detail",
    )
    fake_stream = make_stream(
        ExecutionStateChange(
            payload=ExecutionStateChangePayload(execution_state=execution_state)
        )
    )
    monkeypatch.setattr(
        "langwatch_nlp.studio.app.execute_event_on_a_subprocess", fake_stream
    )

    response = client.post("/execute_sync", json=STOP_EXECUTION_BODY)

    assert response.status_code == 500
    assert "state-change error detail" in response.json()["detail"]
