"""patch_llms reads the history response as a dict (dspy 3.3) or an object (dspy 3.4)."""

from types import SimpleNamespace

import dspy
import pytest

from langwatch.dspy import LangWatchDSPy


class FakeLM:
    model = "fake"

    def __init__(self, response):
        self.history = [{"response": response, "usage": {"prompt_tokens": 1}}]

    def _original_call(self, *args, **kwargs):
        return ["hi"]

    def __call__(self, *args, **kwargs):
        return ["hi"]


@pytest.fixture
def patched_call(monkeypatch):
    monkeypatch.setattr(dspy.LM, "__call__", FakeLM.__call__)
    monkeypatch.delattr(dspy.LM, "_original_call", raising=False)
    tracker = LangWatchDSPy.__new__(LangWatchDSPy)
    tracker.llm_calls_buffer = []
    tracker.patch_llms()
    yield tracker, dspy.LM.__call__
    monkeypatch.undo()


@pytest.mark.parametrize(
    "response",
    [
        {"model": "m", "choices": [1], "_hidden_params": {"additional_headers": {}}},
        SimpleNamespace(model="m", choices=[1], _hidden_params={"additional_headers": {}}),
    ],
    ids=["dict", "object"],
)
def test_reads_response_in_both_shapes(patched_call, response):
    tracker, call = patched_call
    call(FakeLM(response))
    sent = tracker.llm_calls_buffer[0]["response"]
    assert sent["model"] == "m" and sent["choices"] == [1]
    assert "cached" not in sent


def test_missing_headers_marks_cached(patched_call):
    tracker, call = patched_call
    call(FakeLM(SimpleNamespace(model="m")))
    assert tracker.llm_calls_buffer[0]["response"]["cached"] is True
