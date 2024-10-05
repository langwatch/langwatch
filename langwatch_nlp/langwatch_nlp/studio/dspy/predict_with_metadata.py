import time
from typing import Optional, cast
import dspy

# Remove @functools.lru_cache for cached_litellm_completion for proper PredictionWithMetadata info
import langwatch_nlp.studio.dspy.patched_caching


class PredictionWithMetadata(dspy.Prediction):
    def __init__(self, *args, error: Optional[Exception] = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._cost = 0
        self._duration = 0
        self._error = error

    def get_error(self):
        return self._error

    def get_cost(self):
        return self._cost or 0

    def get_duration(self):
        return self._duration or 0


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

        lm = cast(dspy.LM, self.get_lm())
        response.__class__ = PredictionWithMetadata
        last_response = lm.history[-1]
        response._cost = 0
        if last_response:
            response._cost = last_response.get("cost", 0)
        response._duration = duration

        return response
