from typing import cast
import dspy
from langwatch_nlp.studio.dspy.lite_llm import DSPyLiteLLM


class PredictionWithCost(dspy.Prediction):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._cost = 0

    def get_cost(self):
        return self._cost


class PredictWithCost(dspy.Predict):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._cost = 0

    def forward(self, *args, **kwargs):
        response = super().forward(*args, **kwargs)

        lm = cast(DSPyLiteLLM, self.get_lm())
        response.__class__ = PredictionWithCost
        response._cost = lm.cost

        return response
