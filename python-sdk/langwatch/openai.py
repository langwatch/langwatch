from typing import Any, AsyncGenerator, Dict, Generator, List, Optional, Union, cast
import openai
from langwatch.tracer import BaseTracer

from langwatch.types import (
    StepInput,
    StepMetrics,
    StepOutput,
    StepParams,
    StepTimestamps,
    StepTrace,
)
from langwatch.utils import (
    capture_async_chunks_with_timings_and_reyield,
    capture_chunks_with_timings_and_reyield,
    milliseconds_timestamp,
    safe_get,
)


class OpenAICompletionTracer(BaseTracer):
    def __enter__(self):
        super().__enter__()
        self._original_completion_create = openai.Completion.create
        self._original_completion_acreate = openai.Completion.acreate

        def patched_completion_create(*args, **kwargs):
            requested_at = milliseconds_timestamp()
            response = self._original_completion_create(*args, **kwargs)

            if isinstance(response, Generator):
                return capture_chunks_with_timings_and_reyield(
                    response,
                    lambda chunks, first_token_at, finished_at: self.handle_deltas(
                        chunks,
                        StepTimestamps(
                            requested_at=requested_at,
                            first_token_at=first_token_at,
                            finished_at=finished_at,
                        ),
                        **kwargs,
                    ),
                )
            else:
                finished_at = milliseconds_timestamp()
                self.handle_list_or_dict(
                    response,
                    StepTimestamps(requested_at=requested_at, finished_at=finished_at),
                    **kwargs,
                )
                return response

        async def patched_completion_acreate(*args, **kwargs):
            requested_at = milliseconds_timestamp()
            response = await self._original_completion_acreate(*args, **kwargs)

            if isinstance(response, AsyncGenerator):
                return capture_async_chunks_with_timings_and_reyield(
                    response,
                    lambda chunks, first_token_at, finished_at: self.handle_deltas(
                        chunks,
                        StepTimestamps(
                            requested_at=requested_at,
                            first_token_at=first_token_at,
                            finished_at=finished_at,
                        ),
                        **kwargs,
                    ),
                )
            else:
                finished_at = milliseconds_timestamp()
                self.handle_list_or_dict(
                    response,
                    StepTimestamps(requested_at=requested_at, finished_at=finished_at),
                    **kwargs,
                )
                return response

        openai.Completion.create = patched_completion_create
        openai.Completion.acreate = patched_completion_acreate

    def handle_deltas(
        self,
        deltas: List[Union[Dict[Any, Any], List[Any]]],
        timestamps: StepTimestamps,
        **kwargs,
    ):
        text_outputs: Dict[int, str] = {}
        for delta in deltas:
            delta = cast(Dict[Any, Any], delta)
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
                metrics=StepMetrics(),
                timestamps=timestamps,
                **kwargs,
            )
        )

    def handle_list_or_dict(
        self,
        res: Union[List[Any], Dict[Any, Any]],
        timestamps: StepTimestamps,
        **kwargs,
    ):
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
                    timestamps=timestamps,
                    **kwargs,
                )
            )

    def build_trace(
        self,
        raw_response: Any,
        outputs: List[StepOutput],
        metrics: StepMetrics,
        timestamps: StepTimestamps,
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
            metrics=metrics,
            timestamps=timestamps,
        )

    def __exit__(self, _type, _value, _traceback):
        super().__exit__(_type, _value, _traceback)
        openai.Completion.create = self._original_completion_create
