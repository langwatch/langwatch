"""
Regression tests for the Code Agent forward() signature lint
(see issue langwatch/langwatch#3202).

When user code declares Code Agent inputs in the UI but the user's
forward()/__call__() signature doesn't accept those parameter names, the
runtime previously surfaced a confusing
`Code.forward() got an unexpected keyword argument 'input_1'`. The lint
inside `with_autoparsing` now turns this into an actionable error that
names the declared params and the unexpected ones.
"""

import dspy
import pytest

from langwatch_nlp.studio.field_parser import with_autoparsing


class TestForwardSignatureLint:
    def test_matching_signature_runs_normally(self):
        class Code(dspy.Module):
            def forward(self, input: str):
                return dspy.Prediction(output=f"got:{input}")

        Wrapped = with_autoparsing(Code)
        result = Wrapped()(input="hello")
        assert result.output == "got:hello"

    def test_unexpected_kwarg_raises_friendly_error(self):
        class Code(dspy.Module):
            def forward(self, input: str):
                return dspy.Prediction(output=input)

        Wrapped = with_autoparsing(Code)
        with pytest.raises(TypeError) as exc_info:
            Wrapped()(input="hi", input_1="extra")

        msg = str(exc_info.value)
        assert "signature mismatch" in msg
        assert "input_1" in msg
        assert "['input']" in msg
        assert "**kwargs" in msg

    def test_var_keyword_signature_accepts_anything(self):
        class Code(dspy.Module):
            def forward(self, **kwargs):
                return dspy.Prediction(output=",".join(sorted(kwargs.keys())))

        Wrapped = with_autoparsing(Code)
        result = Wrapped()(input="a", input_1="b", input_2="c")
        assert result.output == "input,input_1,input_2"

    def test_multiple_unexpected_kwargs_listed(self):
        class Code(dspy.Module):
            def forward(self, input: str):
                return dspy.Prediction(output=input)

        Wrapped = with_autoparsing(Code)
        with pytest.raises(TypeError) as exc_info:
            Wrapped()(input="x", input_1="y", input_2="z")

        msg = str(exc_info.value)
        assert "input_1" in msg
        assert "input_2" in msg
