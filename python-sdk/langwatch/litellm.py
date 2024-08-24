from types import ModuleType
from typing import (
    Any,
    AsyncGenerator,
    Dict,
    Generator,
    List,
    Optional,
    Set,
    Union,
    cast,
)

import nanoid
from langwatch.tracer import ContextSpan, ContextTrace, get_current_trace

from langwatch.types import (
    ChatMessage,
    SpanInputOutput,
    SpanMetrics,
    TypedValueChatMessages,
    SpanParams,
    SpanTimestamps,
)
from langwatch.utils import (
    capture_async_chunks_with_timings_and_reyield,
    capture_chunks_with_timings_and_reyield,
    milliseconds_timestamp,
    safe_get,
)

from litellm import CustomStreamWrapper
from litellm.types.utils import ModelResponse, Choices, StreamingChoices


class LiteLLMPatch:
    client: ModuleType
    trace: ContextTrace
    tracked_traces: Set[ContextTrace] = set()

    def __init__(
        self,
        client: ModuleType,
        trace: ContextTrace,
    ):
        self.trace = trace
        self.tracked_traces.add(self.trace)

        self.client = client

        if not hasattr(self.client, "_original_completion"):
            self.client._original_completion = self.client.completion  # type: ignore
            self.client._original_acompletion = self.client.acompletion  # type: ignore

            self.client.completion = self.patched_completion_create  # type: ignore
            self.client.acompletion = self.patched_completion_acreate  # type: ignore

    def patched_completion_create(self, *args, **kwargs):
        trace = None
        try:
            trace = get_current_trace()
        except:
            pass

        if not trace or trace not in self.tracked_traces:
            return cast(Any, self.client)._original_completion(*args, **kwargs)

        span = trace.span(
            type="llm",
            span_id=f"span_{nanoid.generate()}",
            parent=trace.get_current_span(),
        )

        started_at = milliseconds_timestamp()
        try:
            response: Union[ModelResponse, CustomStreamWrapper] = cast(
                Any, self.client
            )._original_completion(*args, **kwargs)

            if isinstance(response, CustomStreamWrapper):
                return capture_chunks_with_timings_and_reyield(
                    cast(Generator[ModelResponse, Any, Any], response),
                    lambda chunks, first_token_at, finished_at: LiteLLMPatch.handle_deltas(
                        span,
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
                LiteLLMPatch.handle_completion(
                    span,
                    response,
                    SpanTimestamps(started_at=started_at, finished_at=finished_at),
                    **kwargs,
                )
                return response
        except Exception as err:
            finished_at = milliseconds_timestamp()
            LiteLLMPatch.handle_exception(
                span,
                err,
                SpanTimestamps(started_at=started_at, finished_at=finished_at),
                **kwargs,
            )
            raise err

    async def patched_completion_acreate(self, *args, **kwargs):
        trace = None
        try:
            trace = get_current_trace()
        except:
            pass

        if not trace or trace not in self.tracked_traces:
            return await cast(Any, self.client)._original_acompletion(*args, **kwargs)

        span = trace.span(
            type="llm",
            span_id=f"span_{nanoid.generate()}",
            parent=trace.get_current_span(),
        )

        started_at = milliseconds_timestamp()

        try:
            response: Union[ModelResponse, CustomStreamWrapper] = await cast(
                Any, self.client
            )._original_acompletion(*args, **kwargs)

            if isinstance(response, CustomStreamWrapper):
                return capture_async_chunks_with_timings_and_reyield(
                    cast(AsyncGenerator[ModelResponse, Any], response),
                    lambda chunks, first_token_at, finished_at: LiteLLMPatch.handle_deltas(
                        span,
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
                LiteLLMPatch.handle_completion(
                    span,
                    response,
                    SpanTimestamps(started_at=started_at, finished_at=finished_at),
                    **kwargs,
                )
                return response
        except Exception as err:
            finished_at = milliseconds_timestamp()
            LiteLLMPatch.handle_exception(
                span,
                err,
                SpanTimestamps(started_at=started_at, finished_at=finished_at),
                **kwargs,
            )
            raise err

    @classmethod
    def handle_deltas(
        cls,
        span: ContextSpan,
        deltas: List[ModelResponse],
        timestamps: SpanTimestamps,
        **kwargs,
    ):
        # Accumulate deltas
        chat_outputs: Dict[int, List[ChatMessage]] = {}
        for delta in deltas:
            for choice in delta.choices:
                choice = cast(StreamingChoices, choice)
                index = choice.index
                delta = choice.delta
                if delta.role:
                    chat_message: ChatMessage = {
                        "role": delta.role,
                        "content": delta.content,
                    }
                    if delta.function_call:
                        chat_message["function_call"] = {
                            "name": delta.function_call.name or "",
                            "arguments": delta.function_call.arguments or "",
                        }
                    if delta.tool_calls:
                        chat_message["tool_calls"] = [
                            {
                                "id": tool.id or "",
                                "type": tool.type or "",
                                "function": {
                                    "name": safe_get(tool, "function", "name") or "",
                                    "arguments": safe_get(tool, "function", "arguments")
                                    or "",
                                },
                            }
                            for tool in delta.tool_calls
                        ]
                    if index not in chat_outputs:
                        chat_outputs[index] = []
                    chat_outputs[index].append(chat_message)
                elif delta.function_call:
                    last_item = chat_outputs[index][-1]
                    if "function_call" in last_item and last_item["function_call"]:
                        current_arguments = last_item["function_call"].get(
                            "arguments", ""
                        )
                        last_item["function_call"]["arguments"] = current_arguments + (
                            delta.function_call.arguments or ""
                        )
                elif delta.tool_calls:
                    last_item = chat_outputs[index][-1]
                    if (
                        "tool_calls" in last_item
                        and last_item["tool_calls"]
                        and len(last_item["tool_calls"]) > 0
                    ):
                        for tool in delta.tool_calls:
                            last_item["tool_calls"][tool.index]["function"][
                                "arguments"
                            ] = last_item["tool_calls"][tool.index]["function"].get(
                                "arguments", ""
                            ) + (
                                safe_get(tool, "function", "arguments") or ""
                            )
                elif delta.content:
                    chat_outputs[index][-1]["content"] = (
                        chat_outputs[index][-1].get("content", "") or ""
                    ) + delta.content

        LiteLLMPatch.end_span(
            span=span,
            outputs=[
                TypedValueChatMessages(type="chat_messages", value=output)
                for output in chat_outputs.values()
            ],
            metrics=SpanMetrics(),
            timestamps=timestamps,
            **kwargs,
        )

    @classmethod
    def handle_completion(
        cls,
        span: ContextSpan,
        response: ModelResponse,
        timestamps: SpanTimestamps,
        **kwargs,
    ):
        LiteLLMPatch.end_span(
            span=span,
            outputs=[
                TypedValueChatMessages(
                    type="chat_messages",
                    value=[
                        cast(ChatMessage, cast(Choices, output).message.model_dump(exclude_unset=True))
                    ],
                )
                for output in response.choices
            ],
            metrics=SpanMetrics(
                prompt_tokens=safe_get(response, "usage", "prompt_tokens"),
                completion_tokens=safe_get(response, "usage", "completion_tokens"),
            ),
            timestamps=timestamps,
            **kwargs,
        )

    @classmethod
    def handle_exception(
        cls,
        span: ContextSpan,
        err: Exception,
        timestamps: SpanTimestamps,
        **kwargs,
    ):
        LiteLLMPatch.end_span(
            span=span,
            outputs=[],
            metrics=SpanMetrics(),
            timestamps=timestamps,
            error=err,
            **kwargs,
        )

    @classmethod
    def end_span(
        cls,
        span: ContextSpan,
        outputs: List[SpanInputOutput],
        metrics: SpanMetrics,
        timestamps: SpanTimestamps,
        error: Optional[Exception] = None,
        **kwargs,
    ):
        output: Optional[SpanInputOutput] = (
            None
            if len(outputs) == 0
            else outputs[0] if len(outputs) == 1 else {"type": "list", "value": outputs}
        )
        span_params = SpanParams()
        params = [
            "frequency_penalty",
            "logit_bias",
            "logprobs",
            "top_logprobs",
            "max_tokens",
            "n",
            "presence_penalty",
            "seed",
            "stop",
            "stream",
            "temperature",
            "top_p",
            "tools",
            "tool_choice",
            "parallel_tool_calls",
            "functions",
            "user",
        ]
        for param in params:
            if kwargs.get(param):
                span_params[param] = kwargs.get(param, None)

        span.end(
            model=kwargs.get("model", "unknown"),
            input=TypedValueChatMessages(
                type="chat_messages", value=kwargs.get("messages", []).copy()
            ),
            output=output,
            error=error,
            params=span_params,
            metrics=metrics,
            timestamps=timestamps,
        )
