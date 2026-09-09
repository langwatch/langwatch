import pytest

dspy = pytest.importorskip("dspy")

from langwatch.dspy import DSPyTracer
from langwatch.telemetry.tracing import LangWatchTrace


def test_lm_wrapper_forwarding_supports_dspy_typed_calls():
    """The DSPyTracer LM wrapper must forward *items / request by keyword.

    dspy >= 3.3 tightened BaseLM.__call__ so the legacy path accepts at most one
    positional prompt. The previous wrapper signature (prompt=None, messages=None)
    always forwarded two positional arguments, so typed multi-item calls raised:

        TypeError: Legacy BaseLM calls accept at most one positional prompt.

    See https://github.com/langwatch/langwatch/issues/6913
    """
    if not hasattr(dspy, "LMRequest"):
        pytest.skip("Typed LM calls require dspy >= 3.3")

    trace = LangWatchTrace()
    DSPyTracer(trace=trace)

    class StubLM(dspy.LM):
        forward_contract = "typed_lm"

        def forward(self, request):
            return dspy.LMResponse.from_text("stub", model="stub/model")

    lm = StubLM("stub/model")

    # Typed call: positional LMRequest (the shape dspy 3.3 uses internally).
    result = lm(dspy.LMRequest.from_call(model="stub/model", prompt="hello"))
    assert result.outputs[0].parts[0].text == "stub"

    # Typed call via the request= kwarg.
    result = lm(request=dspy.LMRequest.from_call(model="stub/model", prompt="hello"))
    assert result.outputs[0].parts[0].text == "stub"

    # Legacy single-prompt call keeps working.
    result = lm("hello")
    assert result == ["stub"]


def test_lm_wrapper_does_not_forward_request_to_legacy_call(monkeypatch):
    trace = LangWatchTrace()
    DSPyTracer(trace=trace)

    captured = {}

    def fake_original_call(self, prompt=None, messages=None, **kwargs):
        captured["kwargs"] = dict(kwargs)
        return ["stub"]

    monkeypatch.setattr(dspy.LM, "__original_call__", fake_original_call, raising=False)

    class StubLM(dspy.LM):
        def forward(self, prompt=None, messages=None, **kwargs):
            return ["stub"]

    lm = StubLM("stub/model")

    result = lm("hello")
    assert result == ["stub"]
    assert "request" not in captured["kwargs"]
