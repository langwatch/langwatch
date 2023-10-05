from datetime import datetime
from typing import List
import nanoid
import openai
from contextlib import contextmanager

from langwatch.tracer import send_steps
from langwatch.types import StepInput, StepMetrics, StepOutput, StepParams, StepTrace
from langwatch.utils import safe_get


@contextmanager
def trace():
    trace_id = f"trace_{nanoid.generate()}"

    # TODO: consider async acreate
    _original_completion_create = openai.Completion.create

    steps: List[StepTrace] = []

    def patched_completion_create(*args, **kwargs):
        # TODO: consider streaming
        response: dict = _original_completion_create(*args, **kwargs)

        step_trace = StepTrace(
            trace_id=trace_id,
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
        steps.append(step_trace)

        return response

    openai.Completion.create = patched_completion_create

    yield

    send_steps(steps)

    openai.Completion.create = _original_completion_create
