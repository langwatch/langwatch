"""
Tests for LangWatchWorkflowModule.wrapped() entrypoint resolution.

Verifies that wrapped() handles classes with forward(), __call__(), or both,
matching the same resolution order as execute_component.py and the Go runner.
"""

import dspy
import pytest

from langwatch_nlp.studio.dspy.langwatch_workflow_module import (
    LangWatchWorkflowModule,
)


class ForwardOnlyModule(dspy.Module):
    def forward(self, input: str):
        return dspy.Prediction(output=f"forward:{input}")


class CallOnlyClass:
    def __call__(self, input: str):
        return dspy.Prediction(output=f"call:{input}")


class BothMethodsClass:
    def forward(self, input: str):
        return dspy.Prediction(output=f"forward:{input}")

    def __call__(self, input: str):
        return dspy.Prediction(output=f"call:{input}")


class NeitherMethodClass:
    pass


class TestWrappedModuleEntrypoint:
    def _make_workflow(self):
        class Workflow(LangWatchWorkflowModule):
            def forward(self, **kwargs):
                pass
        return Workflow()

    def test_forward_only_module(self):
        wf = self._make_workflow()
        WrappedClass = wf.wrapped(ForwardOnlyModule, node_id="n1")
        instance = WrappedClass()
        result = instance(input="test")
        assert result.output == "forward:test"

    def test_call_only_class(self):
        wf = self._make_workflow()
        WrappedClass = wf.wrapped(CallOnlyClass, node_id="n2")
        instance = WrappedClass()
        result = instance(input="test")
        assert result.output == "call:test"

    def test_forward_preferred_over_call(self):
        wf = self._make_workflow()
        WrappedClass = wf.wrapped(BothMethodsClass, node_id="n3")
        instance = WrappedClass()
        result = instance(input="test")
        assert result.output == "forward:test"

    def test_neither_method_raises(self):
        wf = self._make_workflow()
        with pytest.raises(TypeError, match="has no callable entrypoint"):
            wf.wrapped(NeitherMethodClass, node_id="n4")

    def test_skipped_when_run_false(self):
        wf = self._make_workflow()
        WrappedClass = wf.wrapped(CallOnlyClass, node_id="n5", run=False)
        instance = WrappedClass()
        result = instance(input="test")
        assert result.status == "skipped"
