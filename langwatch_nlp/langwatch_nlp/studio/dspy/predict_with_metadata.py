import time
from typing import Optional, cast
import dspy
from langevals_core.base_evaluator import Money

# Remove @functools.lru_cache for cached_litellm_completion for proper PredictionWithMetadata info
import langwatch_nlp.studio.dspy.patched_caching


class PredictionWithMetadata(dspy.Prediction):
    def __init__(self, *args, error: Optional[Exception] = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._cost = 0
        self._duration = 0
        self._error = error

    @property
    def error(self):
        return self._error

    @property
    def cost(self):
        return self._cost or 0

    @property
    def duration(self):
        return self._duration or 0


class ModuleWithMetadata:
    _cost = Money(currency="USD", amount=0)
    _duration = 0
    _error: Optional[Exception] = None

    def __init__(self, module: dspy.Module, error: Optional[Exception] = None):
        super().__init__()
        self._module = module
        self._error = error

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)

    def forward(self, *args, **kwargs):
        start_time = time.time()
        response = self._module(*args, **kwargs)
        duration = round((time.time() - start_time) * 1000)

        lm = cast(dspy.LM, self.get_lm()) or dspy.settings.lm
        response.__class__ = PredictionWithMetadata
        last_response = lm.history[-1]
        response._cost = Money(currency="USD", amount=0)
        if last_response and last_response.get("cost"):
            response._cost = Money(currency="USD", amount=last_response.get("cost", 0))
        response._duration = duration

        return response

    def get_lm(self):
        return self._module.get_lm()

    def set_lm(self, lm: dspy.LM):
        self._module.set_lm(lm=lm)


class PredictWithMetadata(dspy.Predict, ModuleWithMetadata):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def forward(self, *args, **kwargs):
        self._module = super().forward
        return ModuleWithMetadata.forward(self, *args, **kwargs)

    def reset(self) -> None:
        lm = self.lm
        super().reset()
        self.lm = lm
