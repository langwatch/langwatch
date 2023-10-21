from typing import Any, AsyncGenerator, Dict, Generator, List, Optional, Union, cast

import nanoid
from langwatch.tracer import BaseContextTracer

from langwatch.types import (
    ChatMessage,
    ErrorCapture,
    SpanMetrics,
    SpanOutput,
    TypedValueChatMessages,
    TypedValueText,
    SpanParams,
    SpanTimestamps,
    LLMSpan,
)
from langwatch.utils import (
    capture_async_chunks_with_timings_and_reyield,
    capture_chunks_with_timings_and_reyield,
    capture_exception,
    milliseconds_timestamp,
    safe_get,
)

import openai


class OpenAITracer(BaseContextTracer):
    """
    Tracing for both Completion and ChatCompletion endpoints
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if "trace_id" not in kwargs:
            kwargs["trace_id"] = self.trace_id
        self.completion_tracer = OpenAICompletionTracer(*args, **kwargs)
        self.chat_completion_tracer = OpenAIChatCompletionTracer(*args, **kwargs)

    def __enter__(self):
        super().__enter__()
        self.completion_tracer.__enter__()
        self.chat_completion_tracer.__enter__()

    def __exit__(self, _type, _value, _traceback):
        super().__exit__(_type, _value, _traceback)
        self.completion_tracer.__exit__(_type, _value, _traceback)
        self.chat_completion_tracer.__exit__(_type, _value, _traceback)


class OpenAICompletionTracer(BaseContextTracer):
    def __enter__(self):
        super().__enter__()
        self._original_completion_create = openai.Completion.create
        self._original_completion_acreate = openai.Completion.acreate

        openai.Completion.create = self.patched_completion_create
        openai.Completion.acreate = self.patched_completion_acreate

    def __exit__(self, _type, _value, _traceback):
        super().__exit__(_type, _value, _traceback)
        openai.Completion.create = self._original_completion_create

    def patched_completion_create(self, *args, **kwargs):
        started_at = milliseconds_timestamp()
        try:
            response = self._original_completion_create(*args, **kwargs)

            if isinstance(response, Generator):
                return capture_chunks_with_timings_and_reyield(
                    response,
                    lambda chunks, first_token_at, finished_at: self.handle_deltas(
                        chunks,
                        SpanTimestamps(
                            started_at=started_at,
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
                    SpanTimestamps(started_at=started_at, finished_at=finished_at),
                    **kwargs,
                )
                return response
        except Exception as err:
            finished_at = milliseconds_timestamp()
            self.handle_exception(
                err,
                SpanTimestamps(started_at=started_at, finished_at=finished_at),
                **kwargs,
            )
            raise err

    async def patched_completion_acreate(self, *args, **kwargs):
        started_at = milliseconds_timestamp()
        response = await self._original_completion_acreate(*args, **kwargs)

        if isinstance(response, AsyncGenerator):
            return capture_async_chunks_with_timings_and_reyield(
                response,
                lambda chunks, first_token_at, finished_at: self.handle_deltas(
                    chunks,
                    SpanTimestamps(
                        started_at=started_at,
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
                SpanTimestamps(started_at=started_at, finished_at=finished_at),
                **kwargs,
            )
            return response

    def handle_deltas(
        self,
        deltas: List[Union[Dict[Any, Any], List[Any]]],
        timestamps: SpanTimestamps,
        **kwargs,
    ):
        raw_response = []
        text_outputs: Dict[int, str] = {}
        for delta in deltas:
            delta = cast(Dict[Any, Any], delta)
            raw_response.append(delta)
            for choice in delta.get("choices", []):
                index = choice.get("index", 0)
                text_outputs[index] = text_outputs.get(index, "") + choice.get(
                    "text", ""
                )

        self.append_span(
            self.build_trace(
                raw_response=raw_response,
                outputs=[
                    TypedValueText(type="text", value=output)
                    for output in text_outputs.values()
                ],
                metrics=SpanMetrics(),
                timestamps=timestamps,
                error=None,
                **kwargs,
            )
        )

    def handle_list_or_dict(
        self,
        res: Union[List[Any], Dict[Any, Any]],
        timestamps: SpanTimestamps,
        **kwargs,
    ):
        responses_list: List[dict] = res if isinstance(res, list) else [res]
        for response in responses_list:
            self.append_span(
                self.build_trace(
                    raw_response=response,
                    outputs=[
                        TypedValueText(type="text", value=output.get("text"))
                        for output in response.get("choices", [])
                    ],
                    metrics=SpanMetrics(
                        prompt_tokens=safe_get(response, "usage", "prompt_tokens"),
                        completion_tokens=safe_get(
                            response, "usage", "completion_tokens"
                        ),
                    ),
                    timestamps=timestamps,
                    error=None,
                    **kwargs,
                )
            )

    def handle_exception(
        self,
        err: Exception,
        timestamps: SpanTimestamps,
        **kwargs,
    ):
        self.append_span(
            self.build_trace(
                raw_response=None,
                outputs=[],
                metrics=SpanMetrics(),
                timestamps=timestamps,
                error=capture_exception(err),
                **kwargs,
            )
        )

    def build_trace(
        self,
        raw_response: Optional[Union[dict, list]],
        outputs: List[SpanOutput],
        metrics: SpanMetrics,
        timestamps: SpanTimestamps,
        error: Optional[ErrorCapture],
        **kwargs,
    ) -> LLMSpan:
        return LLMSpan(
            type="llm",
            id=f"span_{nanoid.generate()}",
            parent_id=self.get_parent_id(),
            trace_id=self.trace_id,
            vendor="openai",
            model=kwargs.get("model", "unknown"),
            input=TypedValueText(type="text", value=kwargs.get("prompt", "")),
            outputs=outputs,
            raw_response=raw_response,
            error=error,
            params=SpanParams(
                temperature=kwargs.get("temperature", 1.0),
                stream=kwargs.get("stream", False),
            ),
            metrics=metrics,
            timestamps=timestamps,
        )


class OpenAIChatCompletionTracer(BaseContextTracer):
    def __enter__(self):
        super().__enter__()
        self._original_completion_create = openai.ChatCompletion.create
        self._original_completion_acreate = openai.ChatCompletion.acreate

        openai.ChatCompletion.create = self.patched_completion_create
        openai.ChatCompletion.acreate = self.patched_completion_acreate

    def __exit__(self, _type, _value, _traceback):
        super().__exit__(_type, _value, _traceback)
        openai.Completion.create = self._original_completion_create

    def patched_completion_create(self, *args, **kwargs):
        started_at = milliseconds_timestamp()
        try:
            response = self._original_completion_create(*args, **kwargs)

            if isinstance(response, Generator):
                return capture_chunks_with_timings_and_reyield(
                    response,
                    lambda chunks, first_token_at, finished_at: self.handle_deltas(
                        chunks,
                        SpanTimestamps(
                            started_at=started_at,
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
                    SpanTimestamps(started_at=started_at, finished_at=finished_at),
                    **kwargs,
                )
                return response
        except Exception as err:
            finished_at = milliseconds_timestamp()
            self.handle_exception(
                err,
                SpanTimestamps(started_at=started_at, finished_at=finished_at),
                **kwargs,
            )
            raise err

    async def patched_completion_acreate(self, *args, **kwargs):
        started_at = milliseconds_timestamp()
        response = await self._original_completion_acreate(*args, **kwargs)

        if isinstance(response, AsyncGenerator):
            return capture_async_chunks_with_timings_and_reyield(
                response,
                lambda chunks, first_token_at, finished_at: self.handle_deltas(
                    chunks,
                    SpanTimestamps(
                        started_at=started_at,
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
                SpanTimestamps(started_at=started_at, finished_at=finished_at),
                **kwargs,
            )
            return response

    def handle_deltas(
        self,
        deltas: List[Union[Dict[Any, Any], List[Any]]],
        timestamps: SpanTimestamps,
        **kwargs,
    ):
        # Accumulate deltas
        raw_response = []
        chat_outputs: Dict[int, List[ChatMessage]] = {}
        for delta in deltas:
            delta = cast(Dict[Any, Any], delta)
            raw_response.append(delta)
            for choice in delta.get("choices", []):
                index = choice.get("index", 0)
                delta = choice.get("delta", {})
                if "role" in delta:
                    chat_message: ChatMessage = {
                        "role": delta.get("role"),
                        "content": delta.get("content"),
                    }
                    if "function_call" in delta:
                        chat_message["function_call"] = delta["function_call"]
                    if index not in chat_outputs:
                        chat_outputs[index] = []
                    chat_outputs[index].append(chat_message)
                elif "function_call" in delta:
                    last_item = chat_outputs[index][-1]
                    if "function_call" in last_item and last_item["function_call"]:
                        current_arguments = last_item["function_call"].get(
                            "arguments", ""
                        )
                        last_item["function_call"][
                            "arguments"
                        ] = current_arguments + delta["function_call"].get(
                            "arguments", ""
                        )
                elif "content" in delta:
                    chat_outputs[index][-1]["content"] = chat_outputs[index][-1].get(
                        "content", ""
                    ) + delta.get("content", "")

        self.append_span(
            self.build_trace(
                raw_response=raw_response,
                outputs=[
                    TypedValueChatMessages(type="chat_messages", value=output)
                    for output in chat_outputs.values()
                ],
                metrics=SpanMetrics(),
                timestamps=timestamps,
                error=None,
                **kwargs,
            )
        )

    def handle_list_or_dict(
        self,
        res: Union[List[Any], Dict[Any, Any]],
        timestamps: SpanTimestamps,
        **kwargs,
    ):
        responses_list: List[dict] = res if isinstance(res, list) else [res]
        for response in responses_list:
            self.append_span(
                self.build_trace(
                    raw_response=response,
                    outputs=[
                        TypedValueChatMessages(
                            type="chat_messages", value=[output.get("message")]
                        )
                        for output in response.get("choices", [])
                    ],
                    metrics=SpanMetrics(
                        prompt_tokens=safe_get(response, "usage", "prompt_tokens"),
                        completion_tokens=safe_get(
                            response, "usage", "completion_tokens"
                        ),
                    ),
                    timestamps=timestamps,
                    error=None,
                    **kwargs,
                )
            )

    def handle_exception(
        self,
        err: Exception,
        timestamps: SpanTimestamps,
        **kwargs,
    ):
        self.append_span(
            self.build_trace(
                raw_response=None,
                outputs=[],
                metrics=SpanMetrics(),
                timestamps=timestamps,
                error=capture_exception(err),
                **kwargs,
            )
        )

    def build_trace(
        self,
        raw_response: Optional[Union[dict, list]],
        outputs: List[SpanOutput],
        metrics: SpanMetrics,
        timestamps: SpanTimestamps,
        error: Optional[ErrorCapture],
        **kwargs,
    ) -> LLMSpan:
        params = SpanParams(
            temperature=kwargs.get("temperature", 1.0),
            stream=kwargs.get("stream", False),
        )
        functions = kwargs.get("functions", None)
        if functions:
            params["functions"] = functions
        return LLMSpan(
            type="llm",
            id=f"span_{nanoid.generate()}",
            parent_id=self.get_parent_id(),
            trace_id=self.trace_id,
            vendor="openai",
            model=kwargs.get("model", "unknown"),
            input=TypedValueChatMessages(
                type="chat_messages", value=kwargs.get("messages", [])
            ),
            outputs=outputs,
            raw_response=raw_response,
            error=error,
            params=params,
            metrics=metrics,
            timestamps=timestamps,
        )
