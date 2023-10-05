from datetime import datetime
from typing import Any, AsyncGenerator, Dict, Generator, List, Union
import openai
from langwatch.tracer import BaseTracer

from langwatch.types import StepInput, StepMetrics, StepOutput, StepParams, StepTrace
from langwatch.utils import safe_get


class OpenAICompletionTracer(BaseTracer):
    def __enter__(self):
        super().__enter__()
        self._original_completion_create = openai.Completion.create
        self._original_completion_acreate = openai.Completion.acreate

        def reyield_and_handle(response, **kwargs):
            deltas = []
            for chunk in response:
                deltas.append(chunk)
                yield chunk
            self.handle_deltas(deltas, **kwargs)

        def patched_completion_create(*args, **kwargs):
            response = self._original_completion_create(*args, **kwargs)
            if isinstance(response, Generator):
                return reyield_and_handle(response, **kwargs)
            else:
                self.handle_list_or_dict(response, **kwargs)
                return response

        async def async_reyield_and_handle(response, **kwargs):
            deltas = []
            async for chunk in response:
                deltas.append(chunk)
                yield chunk
            self.handle_deltas(deltas, **kwargs)

        async def patched_completion_acreate(*args, **kwargs):
            response = await self._original_completion_acreate(*args, **kwargs)
            if isinstance(response, AsyncGenerator):
                return async_reyield_and_handle(response, **kwargs)
            else:
                self.handle_list_or_dict(response, **kwargs)
                return response

        openai.Completion.create = patched_completion_create
        openai.Completion.acreate = patched_completion_acreate

    def handle_deltas(self, deltas: List[Dict[Any, Any]], **kwargs):
        text_outputs: Dict[int, str] = {}
        for delta in deltas:
            for choice in delta.get("choices", []):
                index = choice.get("index", 0)
                text_outputs[index] = text_outputs.get(index, "") + choice.get(
                    "text", ""
                )

        self.steps.append(
            self.build_trace(
                raw_response={},  # TODO
                outputs=[
                    StepOutput(type="text", value=output)
                    for output in text_outputs.values()
                ],
                # TODO: timings
                metrics=StepMetrics(),
                **kwargs,
            )
        )

    def handle_list_or_dict(self, res: Union[List[Any], Dict[Any, Any]], **kwargs):
        responses_list: List[dict] = res if isinstance(res, list) else [res]
        for response in responses_list:
            self.steps.append(
                self.build_trace(
                    raw_response=response,
                    outputs=[
                        StepOutput(type="text", value=output.get("text"))
                        for output in response.get("choices", [])
                    ],
                    metrics=StepMetrics(
                        prompt_tokens=safe_get(response, "usage", "prompt_tokens"),
                        completion_tokens=safe_get(
                            response, "usage", "completion_tokens"
                        ),
                    ),
                    **kwargs,
                )
            )

    def build_trace(
        self,
        raw_response: Any,
        outputs: List[StepOutput],
        metrics: StepMetrics,
        **kwargs,
    ) -> StepTrace:
        return StepTrace(
            trace_id=self.trace_id,
            model=f"openai/{kwargs.get('model', 'unknown')}",
            input=StepInput(type="text", value=kwargs.get("prompt") or ""),
            outputs=outputs,
            raw_response=raw_response,
            params=StepParams(
                temperature=kwargs.get("temperature", 1.0),
                stream=kwargs.get("stream", False),
            ),
            # TODO: timings
            metrics=metrics,
            requested_at=int(datetime.now().timestamp()),
        )

    def __exit__(self, _type, _value, _traceback):
        super().__exit__(_type, _value, _traceback)
        openai.Completion.create = self._original_completion_create
