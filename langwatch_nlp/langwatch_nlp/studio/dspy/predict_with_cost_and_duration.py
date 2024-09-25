import time
from typing import cast
import dspy
from langwatch_nlp.studio.dspy.lite_llm import DSPyLiteLLM


class PredictionWithCostAndDuration(dspy.Prediction):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._cost = 0
        self._duration = 0

    def get_cost(self):
        return self._cost

    def get_duration(self):
        return self._duration


class PredictWithCostAndDuration(dspy.Predict):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._cost = 0
        self._duration = 0

    def forward(self, *args, **kwargs):
        start_time = time.time()
        response = super().forward(*args, **kwargs)
        duration = round((time.time() - start_time) * 1000)

        lm = cast(DSPyLiteLLM, self.get_lm())
        response.__class__ = PredictionWithCostAndDuration
        response._cost = lm.last_cost
        response._duration = duration

        return response
