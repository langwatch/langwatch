from datetime import datetime
from typing import Any
import openai
from langwatch.tracer import BaseTracer

from langwatch.types import StepInput, StepMetrics, StepOutput, StepParams, StepTrace
from langwatch.utils import safe_get


class OpenAITracer(BaseTracer):
    def __enter__(self):
        super().__enter__()
        self._original_completion_create = openai.Completion.create
        self._original_completion_acreate = openai.Completion.acreate

        def patched_completion_create(*args, **kwargs):
            # TODO: consider streaming
            response: dict = self._original_completion_create(*args, **kwargs)
            self.handle_response(response, **kwargs)
            return response

        async def patched_completion_acreate(*args, **kwargs):
            # TODO: consider streaming
            response: dict = await self._original_completion_acreate(*args, **kwargs)
            self.handle_response(response, **kwargs)
            return response

        openai.Completion.create = patched_completion_create
        openai.Completion.acreate = patched_completion_acreate

    def __exit__(self, _type, _value, _traceback):
        super().__exit__(_type, _value, _traceback)
        openai.Completion.create = self._original_completion_create

    def map_response(self, response: Any, **kwargs) -> StepTrace:
        return StepTrace(
            trace_id=self.trace_id,
            model=f"openai/{kwargs.get('model') or 'unknown'}",
            input=StepInput(type="text", value=kwargs.get("prompt") or ""),
            outputs=[
                StepOutput(type="text", value=output.get("text"))
                for output in (response.get("choices") or [])
            ],
            raw_response=response,
            params=StepParams(temperature=(kwargs.get("temperature") or 1.0)),
            metrics=StepMetrics(
                prompt_tokens=safe_get(response, "usage", "prompt_tokens"),
                completion_tokens=safe_get(response, "usage", "completion_tokens"),
            ),
            requested_at=int(datetime.now().timestamp()),
        )
