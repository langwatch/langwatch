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
from deprecated import deprecated

from langwatch.telemetry.context import get_current_trace
from langwatch.tracer import ContextTrace
from langwatch.utils.capture import (
    capture_async_chunks_with_timings_and_reyield,
    capture_chunks_with_timings_and_reyield,
)
from langwatch.utils.utils import milliseconds_timestamp, safe_get
from langwatch.telemetry.span import LangWatchSpan
from langwatch.telemetry.tracing import LangWatchTrace

from langwatch.domain import (
    ChatMessage,
    SpanInputOutput,
    SpanMetrics,
    TraceMetadata,
    TypedValueChatMessages,
    TypedValueText,
    SpanParams,
    SpanTimestamps,
)

from openai import (
    AsyncStream,
    OpenAI,
    AsyncOpenAI,
    Stream,
    AzureOpenAI,
    AsyncAzureOpenAI,
)

from openai.types import Completion
from openai.types.chat import ChatCompletion, ChatCompletionChunk
from openai.types.chat.chat_completion_chunk import ChoiceDeltaToolCall


class OpenAITracer:
    """
    Tracing for both Completion and ChatCompletion endpoints
    """

    trace: LangWatchTrace

    def __init__(
        self,
        client: Union[OpenAI, AsyncOpenAI, AzureOpenAI, AsyncAzureOpenAI],
        trace: Optional[LangWatchTrace] = None,
        # Deprecated: mantained for retrocompatibility
        trace_id: Optional[str] = None,
        # Deprecated: mantained for retrocompatibility
        metadata: Optional[TraceMetadata] = None,
    ):
        if trace:
            self.trace = trace
        else:
            self.trace = ContextTrace()
        self.completion_tracer = OpenAICompletionTracer(client=client, trace=self.trace)
        self.chat_completion_tracer = OpenAIChatCompletionTracer(
            client=client, trace=self.trace
        )

    @deprecated(
        "Using OpenAITracer as a context manager is deprecated. Use `langwatch.get_current_trace().autotrack_openai_calls(client)` instead."
    )
    def __enter__(self):
        self.trace.__enter__()

    def __exit__(self, _type, _value, _traceback):
        self.trace.__exit__(_type, _value, _traceback)


# Deprecated: mantained for retrocompatibility
class AzureOpenAITracer(OpenAITracer):
    """
    Tracing for both Completion and ChatCompletion endpoints
    """

    def __init__(
        self,
        client: Union[AzureOpenAI, AsyncAzureOpenAI],
        trace: Optional[ContextTrace] = None,
        # Deprecated: mantained for retrocompatibility
        trace_id: Optional[str] = None,
        # Deprecated: mantained for retrocompatibility
        metadata: Optional[TraceMetadata] = None,
    ):
        super().__init__(
            client=client,
            trace=trace,
            trace_id=trace_id,
            metadata=metadata,
        )


class OpenAICompletionTracer:
    trace: ContextTrace
    tracked_traces: Set[ContextTrace] = set()

    def __init__(
        self,
        client: Union[OpenAI, AsyncOpenAI, AzureOpenAI, AsyncAzureOpenAI],
        trace: Optional[ContextTrace] = None,
        # Deprecated: mantained for retrocompatibility
        trace_id: Optional[str] = None,
        # Deprecated: mantained for retrocompatibility
        metadata: Optional[TraceMetadata] = None,
    ):
        self.client = client
        if trace:
            self.trace = trace
        else:
            self.trace = ContextTrace()
        self.tracked_traces.add(self.trace)

        if not hasattr(self.client.completions, "_original_create"):
            self.client.completions._original_create = self.client.completions.create  # type: ignore
            if isinstance(self.client, AsyncOpenAI):
                self.client.completions.create = self.patched_completion_acreate  # type: ignore
            else:
                self.client.completions.create = self.patched_completion_create  # type: ignore

    @deprecated(
        "Using OpenAICompletionTracer as a context manager is deprecated. Use `langwatch.get_current_trace().autotrack_openai_calls(client)` instead."
    )
    def __enter__(self):
        self.trace.__enter__()

    # Deprecated: mantained for retrocompatibility
    def __exit__(self, _type, _value, _traceback):
        self.trace.__exit__(_type, _value, _traceback)

    def patched_completion_create(self, *args, **kwargs):
        trace = None
        try:
            trace = get_current_trace()
        except:
            pass

        if not trace or trace not in self.tracked_traces:
            return cast(Any, self.client.completions)._original_create(*args, **kwargs)

        span = trace.span(type="llm").__enter__()

        started_at = milliseconds_timestamp()
        try:
            response: Union[Completion, Stream[Completion]] = cast(
                Any, self.client.completions
            )._original_create(*args, **kwargs)

            if isinstance(response, Stream):
                return capture_chunks_with_timings_and_reyield(
                    cast(Generator[Completion, Any, Any], response),
                    lambda chunks, first_token_at, finished_at: OpenAICompletionTracer.handle_deltas(
                        self.client,
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
                OpenAICompletionTracer.handle_completion(
                    self.client,
                    span,
                    response,
                    SpanTimestamps(started_at=started_at, finished_at=finished_at),
                    **kwargs,
                )
                return response
        except Exception as err:
            finished_at = milliseconds_timestamp()
            OpenAICompletionTracer.handle_exception(
                self.client,
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
            return await cast(Any, self.client.completions)._original_create(
                *args, **kwargs
            )

        span = trace.span(type="llm").__enter__()

        started_at = milliseconds_timestamp()
        response: Union[Completion, AsyncStream[Completion]] = await cast(
            Any, self.client.completions
        )._original_create(*args, **kwargs)

        try:
            if isinstance(response, AsyncStream):
                return capture_async_chunks_with_timings_and_reyield(
                    cast(AsyncGenerator[Completion, Any], response),
                    lambda chunks, first_token_at, finished_at: OpenAICompletionTracer.handle_deltas(
                        self.client,
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
                OpenAICompletionTracer.handle_completion(
                    self.client,
                    span,
                    response,
                    SpanTimestamps(started_at=started_at, finished_at=finished_at),
                    **kwargs,
                )
                return response
        except Exception as err:
            finished_at = milliseconds_timestamp()
            OpenAICompletionTracer.handle_exception(
                self.client,
                span,
                err,
                SpanTimestamps(started_at=started_at, finished_at=finished_at),
                **kwargs,
            )
            raise err

    @classmethod
    def handle_deltas(
        cls,
        client: Union[OpenAI, AsyncOpenAI, AzureOpenAI, AsyncAzureOpenAI],
        span: LangWatchSpan,
        deltas: List[Completion],
        timestamps: SpanTimestamps,
        **kwargs,
    ):
        text_outputs: Dict[int, str] = {}
        for delta in deltas:
            for choice in delta.choices:
                index = choice.index or 0
                text_outputs[index] = text_outputs.get(index, "") + (choice.text or "")

        OpenAICompletionTracer.end_span(
            client=client,
            span=span,
            outputs=[
                TypedValueText(type="text", value=output)
                for output in text_outputs.values()
            ],
            metrics=SpanMetrics(),
            timestamps=timestamps,
            **kwargs,
        )

    @classmethod
    def handle_completion(
        cls,
        client: Union[OpenAI, AsyncOpenAI, AzureOpenAI, AsyncAzureOpenAI],
        span: LangWatchSpan,
        response: Completion,
        timestamps: SpanTimestamps,
        **kwargs,
    ):
        OpenAICompletionTracer.end_span(
            client=client,
            span=span,
            outputs=[
                TypedValueText(type="text", value=output.text)
                for output in response.choices
            ],
            metrics=SpanMetrics(
                prompt_tokens=safe_get(response, "usage", "prompt_tokens"),
                completion_tokens=safe_get(response, "usage", "completion_tokens"),
                reasoning_tokens=safe_get(
                    response, "usage", "completion_tokens_details", "reasoning_tokens"
                ),
            ),
            timestamps=timestamps,
            **kwargs,
        )

    @classmethod
    def handle_exception(
        cls,
        client: Union[OpenAI, AsyncOpenAI, AzureOpenAI, AsyncAzureOpenAI],
        span: LangWatchSpan,
        err: Exception,
        timestamps: SpanTimestamps,
        **kwargs,
    ):
        OpenAICompletionTracer.end_span(
            client=client,
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
        client: Union[OpenAI, AsyncOpenAI, AzureOpenAI, AsyncAzureOpenAI],
        span: LangWatchSpan,
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
        param_names = [
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
            "response_format",
            "reasoning_effort",
        ]
        for param in param_names:
            if kwargs.get(param) is not None:
                span_params[param] = kwargs.get(param)

        vendor = (
            "azure"
            if issubclass(type(client), AzureOpenAI)
            or issubclass(type(client), AsyncAzureOpenAI)
            else "openai"
        )

        span.update(
            model=vendor + "/" + kwargs.get("model", "unknown"),
            input=TypedValueChatMessages(
                type="chat_messages", value=kwargs.get("messages", []).copy()
            ),
            output=output,
            error=error,
            params=span_params,
            metrics=metrics,
            timestamps=timestamps,
        )

        span.end()


def _merge_tool_call_deltas(
    message: ChatMessage, tool_calls: List[ChoiceDeltaToolCall]
) -> None:
    """Merge streamed tool-call deltas into a message by tool index.

    The list is grown to cover any index the stream introduces (parallel
    tool calls open index 1+ mid-stream), and each delta's id, type, name
    and argument fragment are merged into its indexed entry. Placeholders
    for indices the stream never fills are dropped by
    _prune_blank_tool_calls before the span is persisted.
    """
    existing = message.get("tool_calls")
    if not existing:
        existing = []
        message["tool_calls"] = existing
    for tool in tool_calls:
        while len(existing) <= tool.index:
            existing.append(
                {"id": "", "type": "", "function": {"name": "", "arguments": ""}}
            )
        entry = existing[tool.index]
        if tool.id:
            entry["id"] = tool.id
        if tool.type:
            entry["type"] = tool.type
        name = safe_get(tool, "function", "name")
        if name:
            entry["function"]["name"] = name
        arguments = safe_get(tool, "function", "arguments")
        if arguments:
            entry["function"]["arguments"] = (
                entry["function"].get("arguments", "") + arguments
            )


def _prune_blank_tool_calls(message: ChatMessage) -> None:
    """Drop placeholder tool-call entries the stream never filled.

    _merge_tool_call_deltas pads the list up to the highest index seen, so
    a stream that skips an index leaves a fully blank entry behind; persist
    only entries that carry any data.
    """
    tool_calls = message.get("tool_calls")
    if not tool_calls:
        return
    kept = [
        entry
        for entry in tool_calls
        if entry.get("id")
        or entry.get("type")
        or entry.get("function", {}).get("name")
        or entry.get("function", {}).get("arguments")
    ]
    if kept:
        message["tool_calls"] = kept
    else:
        del message["tool_calls"]


class OpenAIChatCompletionTracer:
    trace: ContextTrace
    tracked_traces: Set[ContextTrace] = set()

    def __init__(
        self,
        client: Union[OpenAI, AsyncOpenAI, AzureOpenAI, AsyncAzureOpenAI],
        trace: Optional[ContextTrace] = None,
        # Deprecated: mantained for retrocompatibility
        trace_id: Optional[str] = None,
        # Deprecated: mantained for retrocompatibility
        metadata: Optional[TraceMetadata] = None,
    ):
        self.client = client
        if trace:
            self.trace = trace
        else:
            self.trace = ContextTrace()
        self.tracked_traces.add(self.trace)

        if not hasattr(self.client.chat.completions, "_original_create"):
            self.client.chat.completions._original_create = self.client.chat.completions.create  # type: ignore
            if isinstance(self.client, AsyncOpenAI):
                self.client.chat.completions.create = self.patched_completion_acreate  # type: ignore
            elif isinstance(self.client, AsyncAzureOpenAI):
                self.client.chat.completions.create = self.patched_completion_acreate  # type: ignore
            else:
                self.client.chat.completions.create = self.patched_completion_create  # type: ignore

    @deprecated(
        "Using OpenAIChatCompletionTracer as a context manager is deprecated. Use `langwatch.get_current_trace().autotrack_openai_calls(client)` instead."
    )
    def __enter__(self):
        self.trace.__enter__()

    # Deprecated: mantained for retrocompatibility
    def __exit__(self, _type, _value, _traceback):
        self.trace.__exit__(_type, _value, _traceback)

    def patched_completion_create(self, *args, **kwargs):
        trace = None
        try:
            trace = get_current_trace()
        except:
            pass

        if not trace or trace not in self.tracked_traces:
            return cast(Any, self.client.chat.completions)._original_create(
                *args, **kwargs
            )

        span = trace.span(type="llm").__enter__()

        started_at = milliseconds_timestamp()
        try:
            response: Union[ChatCompletion, Stream[ChatCompletionChunk]] = cast(
                Any, self.client.chat.completions
            )._original_create(*args, **kwargs)

            if isinstance(response, Stream):
                return capture_chunks_with_timings_and_reyield(
                    cast(Generator[ChatCompletionChunk, Any, Any], response),
                    lambda chunks, first_token_at, finished_at: OpenAIChatCompletionTracer.handle_deltas(
                        self.client,
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
                OpenAIChatCompletionTracer.handle_completion(
                    self.client,
                    span,
                    response,
                    SpanTimestamps(started_at=started_at, finished_at=finished_at),
                    **kwargs,
                )
                return response
        except Exception as err:
            finished_at = milliseconds_timestamp()
            OpenAIChatCompletionTracer.handle_exception(
                self.client,
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
            return await cast(Any, self.client.chat.completions)._original_create(
                *args, **kwargs
            )

        span = trace.span(type="llm").__enter__()

        started_at = milliseconds_timestamp()

        response: Union[ChatCompletion, AsyncStream[ChatCompletionChunk]] = await cast(
            Any, self.client.chat.completions
        )._original_create(*args, **kwargs)

        try:
            if isinstance(response, AsyncStream):
                return capture_async_chunks_with_timings_and_reyield(
                    cast(AsyncGenerator[ChatCompletionChunk, Any], response),
                    lambda chunks, first_token_at, finished_at: OpenAIChatCompletionTracer.handle_deltas(
                        self.client,
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
                OpenAIChatCompletionTracer.handle_completion(
                    self.client,
                    span,
                    response,
                    SpanTimestamps(started_at=started_at, finished_at=finished_at),
                    **kwargs,
                )
                return response
        except Exception as err:
            finished_at = milliseconds_timestamp()
            OpenAIChatCompletionTracer.handle_exception(
                self.client,
                span,
                err,
                SpanTimestamps(started_at=started_at, finished_at=finished_at),
                **kwargs,
            )
            raise err

    @classmethod
    def handle_deltas(
        cls,
        client: Union[OpenAI, AsyncOpenAI, AzureOpenAI, AsyncAzureOpenAI],
        span: LangWatchSpan,
        deltas: List[ChatCompletionChunk],
        timestamps: SpanTimestamps,
        **kwargs,
    ):
        # Accumulate deltas
        chat_outputs: Dict[int, List[ChatMessage]] = {}
        # Choices whose current message was started without a role delta
        # (role defaulted to "assistant"). A late role delta adopts that
        # message instead of starting a second one.
        synthesized_roles: Set[int] = set()
        usage = None
        for delta in deltas:
            if hasattr(delta, "usage") and delta.usage is not None:
                usage = delta.usage
            for choice in delta.choices:
                index = choice.index
                delta = choice.delta
                if delta.role and index in synthesized_roles:
                    last_item = chat_outputs[index][-1]
                    last_item["role"] = delta.role  # type: ignore
                    if delta.content:
                        last_item["content"] = (
                            last_item.get("content", "") or ""
                        ) + delta.content
                    if delta.function_call:
                        if "function_call" in last_item and last_item["function_call"]:
                            current_arguments = last_item["function_call"].get(
                                "arguments", ""
                            )
                            last_item["function_call"]["arguments"] = (
                                current_arguments
                                + (delta.function_call.arguments or "")
                            )
                            if delta.function_call.name:
                                last_item["function_call"]["name"] = (
                                    delta.function_call.name
                                )
                        else:
                            last_item["function_call"] = {
                                "name": delta.function_call.name or "",
                                "arguments": delta.function_call.arguments or "",
                            }
                    if delta.tool_calls:
                        _merge_tool_call_deltas(last_item, delta.tool_calls)
                    synthesized_roles.discard(index)
                    continue
                # Some OpenAI-compatible backends (the LangWatch AI Gateway
                # among them) never send the role-carrying first delta that
                # api.openai.com sends, so the first delta for a choice may
                # already carry content or tool calls. Start the message on
                # whichever delta arrives first.
                if delta.role or index not in chat_outputs:
                    if not delta.role:
                        synthesized_roles.add(index)
                    chat_message: ChatMessage = {
                        "role": delta.role or "assistant",  # type: ignore
                        "content": delta.content,
                    }
                    if delta.function_call:
                        chat_message["function_call"] = {
                            "name": delta.function_call.name or "",
                            "arguments": delta.function_call.arguments or "",
                        }
                    if delta.tool_calls:
                        _merge_tool_call_deltas(chat_message, delta.tool_calls)
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
                    _merge_tool_call_deltas(chat_outputs[index][-1], delta.tool_calls)
                elif delta.content:
                    chat_outputs[index][-1]["content"] = (
                        chat_outputs[index][-1].get("content", "") or ""
                    ) + delta.content

        for output in chat_outputs.values():
            for message in output:
                _prune_blank_tool_calls(message)
        OpenAIChatCompletionTracer.end_span(
            client=client,
            span=span,
            outputs=[
                TypedValueChatMessages(type="chat_messages", value=output)
                for output in chat_outputs.values()
            ],
            metrics=(
                SpanMetrics(
                    prompt_tokens=usage.prompt_tokens if usage else None,
                    completion_tokens=usage.completion_tokens if usage else None,
                    reasoning_tokens=safe_get(
                        usage, "completion_tokens_details", "reasoning_tokens"
                    ),
                )
                if usage
                else SpanMetrics()
            ),
            timestamps=timestamps,
            **kwargs,
        )

    @classmethod
    def handle_completion(
        cls,
        client: Union[OpenAI, AsyncOpenAI, AzureOpenAI, AsyncAzureOpenAI],
        span: LangWatchSpan,
        response: ChatCompletion,
        timestamps: SpanTimestamps,
        **kwargs,
    ):
        OpenAIChatCompletionTracer.end_span(
            client=client,
            span=span,
            outputs=[
                TypedValueChatMessages(
                    type="chat_messages",
                    value=[
                        cast(ChatMessage, output.message.model_dump(exclude_unset=True))
                    ],
                )
                for output in response.choices
            ],
            metrics=SpanMetrics(
                prompt_tokens=safe_get(response, "usage", "prompt_tokens"),
                completion_tokens=safe_get(response, "usage", "completion_tokens"),
                reasoning_tokens=safe_get(
                    response, "usage", "completion_tokens_details", "reasoning_tokens"
                ),
            ),
            timestamps=timestamps,
            **kwargs,
        )

    @classmethod
    def handle_exception(
        cls,
        client: Union[OpenAI, AsyncOpenAI, AzureOpenAI, AsyncAzureOpenAI],
        span: LangWatchSpan,
        err: Exception,
        timestamps: SpanTimestamps,
        **kwargs,
    ):
        OpenAIChatCompletionTracer.end_span(
            client=client,
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
        client: Union[OpenAI, AsyncOpenAI, AzureOpenAI, AsyncAzureOpenAI],
        span: LangWatchSpan,
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
        param_names = [
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
            "response_format",
            "reasoning_effort",
        ]
        for param in param_names:
            if kwargs.get(param) is not None:
                span_params[param] = kwargs.get(param)

        vendor = (
            "azure"
            if issubclass(type(client), AzureOpenAI)
            or issubclass(type(client), AsyncAzureOpenAI)
            else "openai"
        )

        span.update(
            model=vendor + "/" + kwargs.get("model", "unknown"),
            input=TypedValueChatMessages(
                type="chat_messages", value=kwargs.get("messages", []).copy()
            ),
            output=output,
            error=error,
            params=span_params,
            metrics=metrics,
            timestamps=timestamps,
        )

        span.end()
