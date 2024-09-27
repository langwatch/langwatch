import time
from typing import Optional, cast
import dspy
from langwatch_nlp.studio.dspy.lite_llm import DSPyLiteLLM


class PredictionWithMetadata(dspy.Prediction):
    def __init__(self, *args, error: Optional[Exception] = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._cost = 0
        self._duration = 0
        self._error = error

    def get_error(self):
        return self._error

    def get_cost(self):
        return self._cost

    def get_duration(self):
        return self._duration


class PredictWithMetadata(dspy.Predict):
    def __init__(self, *args, error: Optional[Exception] = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._cost = 0
        self._duration = 0
        self._error = error

    def forward(self, *args, **kwargs):
        start_time = time.time()
        response = super().forward(*args, **kwargs)
        duration = round((time.time() - start_time) * 1000)

        lm = cast(DSPyLiteLLM, self.get_lm())
        response.__class__ = PredictionWithMetadata
        response._cost = lm.last_cost
        response._duration = duration

        return response
