import json
from typing import (
    TYPE_CHECKING,
    Any,
    Callable,
    Dict,
    List,
    Literal,
    Optional,
    TypedDict,
    Union,
)
from warnings import warn
from langchain.schema import (
    LLMResult,
    AgentAction,
    AgentFinish,
    BaseMessage,
    HumanMessage,
    AIMessage,
    SystemMessage,
    FunctionMessage,
    ChatGeneration,
)
from langwatch.utils.initialization import ensure_setup
from opentelemetry.trace import get_current_span, SpanContext
from langchain.callbacks.base import BaseCallbackHandler
from langwatch.telemetry.span import LangWatchSpan
from langwatch.telemetry.tracing import LangWatchTrace
from langwatch.utils.transformation import (
    SerializableWithStringFallback,
    convert_typed_values,
)
from langwatch.utils.utils import list_get, milliseconds_timestamp
import langwatch
from langwatch.domain import (
    ChatMessage,
    ChatRole,
    SpanParams,
    RAGChunk,
    SpanInputOutput,
    SpanMetrics,
    SpanTimestamps,
    TraceMetadata,
    TypedValueChatMessages,
    TypedValueJson,
    TypedValueList,
    TypedValueText,
)

from uuid import UUID
from langchain.tools import BaseTool
import logging


class SpanParams(TypedDict, total=False):
    frequency_penalty: Optional[float]
    logit_bias: Optional[Dict[str, float]]
    logprobs: Optional[bool]
    top_logprobs: Optional[int]
    max_tokens: Optional[int]
    n: Optional[int]
    presence_penalty: Optional[float]
    seed: Optional[int]
    stop: Optional[Union[str, List[str]]]
    stream: Optional[bool]
    temperature: Optional[float]
    top_p: Optional[float]
    tools: Optional[List[Dict[str, Any]]]
    tool_choice: Optional[str]
    parallel_tool_calls: Optional[bool]
    functions: Optional[List[Dict[str, Any]]]
    user: Optional[str]


if TYPE_CHECKING:
    from langchain_core.documents import Document
    from langchain_core.retrievers import BaseRetriever
    from langchain_core.callbacks.manager import (
        AsyncCallbackManagerForRetrieverRun,
        CallbackManagerForRetrieverRun,
    )


def langchain_messages_to_chat_messages(
    langchain_messages: List[List[BaseMessage]],
) -> List[ChatMessage]:
    langwatch_chat_messages: List[ChatMessage] = []
    for messages in langchain_messages:  # no idea why are they two arrays here
        for message in messages:
            langwatch_chat_messages.append(langchain_message_to_chat_message(message))
    return langwatch_chat_messages


def langchain_message_to_chat_message(message: BaseMessage) -> ChatMessage:
    role: ChatRole = "user"
    if isinstance(message, HumanMessage):
        role = "user"
    elif isinstance(message, AIMessage):
        role = "assistant"
    elif isinstance(message, SystemMessage):
        role = "system"
    elif isinstance(message, FunctionMessage):
        role = "assistant"
        return ChatMessage(role="assistant", content=message.content, function_call=message.additional_kwargs)  # type: ignore
    else:
        role = "unknown"
    # TODO: handle function types! where is the name?
    return ChatMessage(role=role, content=message.content)  # type: ignore


class LangChainTracer(BaseCallbackHandler):
    """LangWatch callback handler that can be used to handle callbacks from langchain."""

    def __init__(
        self,
        trace: Optional[LangWatchTrace] = None,
        # Deprecated: mantained for retrocompatibility
        trace_id: Optional[str] = None,
        # Deprecated: mantained for retrocompatibility
        metadata: Optional[TraceMetadata] = None,
    ) -> None:
        self.trace: LangWatchTrace
        self.spans: Dict[str, LangWatchSpan] = {}

        ensure_setup()

        if trace:
            self.trace = trace
        else:
            self.trace = langwatch.trace(trace_id=trace_id, metadata=metadata)

        # Demote the "Failed to detach context" log raised by the OpenTelemetry logger to DEBUG
        # level so that it does not show up in the user's console. This warning may indicate
        # some incorrect context handling, but in the case of langchain it's just a false positive.
        # due to the way the async/generations and callback calls are handled in the langchain library.
        self._suppress_token_detach_warning_to_debug_level()

    def __enter__(self):
        self.trace.__enter__()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.trace.__exit__(exc_type, exc_value, traceback)

    def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        *,
        run_id: UUID,
        parent_run_id: Union[UUID, None] = None,
        tags: Union[List[str], None] = None,  # TODO?
        metadata: Union[Dict[str, Any], None] = None,  # TODO?
        **kwargs: Any,
    ) -> Any:
        self.spans[str(run_id)] = self._build_llm_span(
            serialized=serialized,
            run_id=run_id,
            parent_run_id=parent_run_id,
            input=TypedValueJson(
                type="json",
                value=prompts,
            ),
            **kwargs,
        )

    def on_chat_model_start(
        self,
        serialized: Dict[str, Any],
        messages: List[List[BaseMessage]],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID],
        **kwargs: Any,
    ) -> Any:
        self.spans[str(run_id)] = self._build_llm_span(
            serialized=serialized,
            run_id=run_id,
            parent_run_id=parent_run_id,
            input=TypedValueChatMessages(
                type="chat_messages",
                value=langchain_messages_to_chat_messages(messages),
            ),
            **kwargs,
        )

    def _build_llm_span(
        self,
        serialized: Dict[str, Any],
        run_id: UUID,
        parent_run_id: Optional[UUID],
        input: SpanInputOutput,
        **kwargs: Any,
    ) -> LangWatchSpan:
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
            if kwargs.get("invocation_params", {}).get(param):
                span_params[param] = kwargs.get("invocation_params", {}).get(
                    param, None
                )

        vendor = list_get(serialized.get("id", []), 2, "unknown").lower()
        if vendor.startswith("chat"):
            vendor = vendor.replace("chat", "")
        model = (
            kwargs.get("metadata", {}).get("ls_model_name", None)
            or kwargs.get("invocation_params", {}).get("model_name", None)
            or kwargs.get("invocation_params", {}).get("model", "unknown")
        )

        span = langwatch.span(
            type="llm",
            parent=self.spans.get(str(parent_run_id)),
            trace=self.trace,
            model=(vendor + "/" + model),
            input=input,
            timestamps=SpanTimestamps(started_at=milliseconds_timestamp()),
            params=span_params,
        )
        span.__enter__()

        self.spans[str(run_id)] = span

        return span

    def on_llm_new_token(self, token: str, **kwargs: Any) -> Any:
        # TODO: capture first_token_at, copy from TypeScript implementation and test it
        pass

    def on_llm_end(self, response: LLMResult, *, run_id: UUID, **kwargs: Any) -> Any:
        span = self.spans.get(str(run_id))
        if span == None:
            return

        outputs: List[SpanInputOutput] = []
        for generations in response.generations:
            # TODO: why the twice loop? Can OpenAI generate multiple chat outputs?
            for g in generations:
                if isinstance(g, ChatGeneration):
                    outputs.append(
                        TypedValueChatMessages(
                            type="chat_messages",
                            value=[langchain_message_to_chat_message(g.message)],
                        )
                    )
                else:
                    # TODO: test this
                    outputs.append(
                        TypedValueText(
                            type="text",
                            value=g.text,
                        )
                    )
        output = (
            None
            if len(outputs) == 0
            else (
                outputs[0]
                if len(outputs) == 1
                else TypedValueList(type="list", value=outputs)
            )
        )

        span.update(output=output)
        if response.llm_output and "token_usage" in response.llm_output:
            usage = response.llm_output["token_usage"]
            span.update(
                metrics=SpanMetrics(
                    prompt_tokens=usage.get("prompt_tokens"),
                    completion_tokens=usage.get("completion_tokens"),
                )
            )
        span.__exit__(None, None, None)

    def on_llm_error(self, error: Exception, *, run_id: UUID, **kwargs: Any) -> Any:
        span = self.spans.get(str(run_id))
        if span == None:
            return

        span.__exit__(None, error, None)

    def on_chain_start(
        self,
        serialized: Dict[str, Any],
        inputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID],
        name: Optional[str],
        **kwargs: Any,
    ) -> Any:
        self.spans[str(run_id)] = self._build_base_span(
            type="chain",
            run_id=run_id,
            parent_run_id=parent_run_id,
            name=name if name else list_get(serialized.get("id", ""), -1, None),
            input=self._autoconvert_typed_values(inputs),
        )

    def on_chain_end(
        self, outputs: Dict[str, Any], *, run_id: UUID, **kwargs: Any
    ) -> Any:
        self._end_base_span(run_id, output=self._autoconvert_typed_values(outputs))

    def on_chain_error(self, error: Exception, *, run_id: UUID, **kwargs: Any) -> Any:
        self._on_error_base_span(run_id, error)

    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Union[List[str], None] = None,  # TODO?
        metadata: Union[Dict[str, Any], None] = None,  # TODO?
        **kwargs: Any,
    ) -> Any:
        self.spans[str(run_id)] = self._build_base_span(
            type="tool",
            run_id=run_id,
            parent_run_id=parent_run_id,
            name=serialized.get("name"),
            input=self._autoconvert_typed_values(input_str),
        )

    def _build_base_span(
        self,
        type: Literal["span", "chain", "tool", "agent"],
        run_id: UUID,
        parent_run_id: Optional[UUID],
        name: Optional[str],
        input: Optional[SpanInputOutput],
    ) -> LangWatchSpan:
        span = langwatch.span(
            type=type,
            name=name,
            parent=self.spans.get(str(parent_run_id)),
            trace=self.trace,
            input=input,
            output=None,
            error=None,
            timestamps=SpanTimestamps(started_at=milliseconds_timestamp()),
        )
        span.__enter__()

        return span

    def _end_base_span(self, run_id: UUID, output: SpanInputOutput):
        span = self.spans.get(str(run_id))
        if span == None:
            return

        span.update(output=output)
        span.__exit__(None, None, None)

    def _on_error_base_span(self, run_id: UUID, error: Exception):
        span = self.spans.get(str(run_id))
        if span == None:
            return

        span.__exit__(type(error), error, error.__traceback__)

    def on_tool_end(
        self,
        output: str,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> Any:
        self._end_base_span(run_id, output=self._autoconvert_typed_values(output))

    def on_tool_error(self, error: Exception, *, run_id: UUID, **kwargs: Any) -> Any:
        self._on_error_base_span(run_id, error)

    def on_text(self, text: str, **kwargs: Any) -> Any:
        pass

    def on_agent_action(
        self,
        action: AgentAction,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        if str(run_id) in self.spans:
            self.spans[str(run_id)].update(type="agent")

    def on_agent_finish(
        self,
        finish: AgentFinish,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        self._end_base_span(
            run_id, output=self._autoconvert_typed_values(finish.return_values)
        )

    def _autoconvert_typed_values(self, output: Any) -> SpanInputOutput:
        if isinstance(output, BaseMessage):
            return TypedValueChatMessages(
                type="chat_messages", value=[langchain_message_to_chat_message(output)]
            )
        elif type(output) == list and isinstance(list_get(output, 0), BaseMessage):
            return TypedValueChatMessages(
                type="chat_messages",
                value=[langchain_message_to_chat_message(m) for m in output],
            )
        elif (
            type(output) == list
            and type(list_get(output, 0)) == list
            and isinstance(list_get(output[0], 0), BaseMessage)
        ):
            return TypedValueChatMessages(
                type="chat_messages",
                value=langchain_messages_to_chat_messages(output),
            )
        else:
            return convert_typed_values(output)

    def _suppress_token_detach_warning_to_debug_level(self):
        """
        Convert the "Failed to detach context" log raised by the OpenTelemetry logger to DEBUG
        level so that it does not show up in the user's console.
        """
        from opentelemetry.context import logger as otel_logger

        if not any(isinstance(f, LogDemotionFilter) for f in otel_logger.filters):
            log_filter = LogDemotionFilter(
                "opentelemetry.context", "Failed to detach context"
            )
            otel_logger.addFilter(log_filter)


class WrappedRagTool(BaseTool):
    tool: Optional[BaseTool] = None
    context_extractor: Optional[Callable[[Any], List[RAGChunk]]] = None

    def __init__(self, tool, context_extractor):
        super().__init__(name=tool.name, description=tool.description)
        self.tool = tool
        self.context_extractor = context_extractor

    def _run(self, *args, **kwargs):
        if self.tool is None or self.context_extractor is None:
            raise ValueError("tool or context_extractor is not set")

        input = ""
        try:
            if len(args) == 1:
                if type(args[0]) == str:
                    input = args[0]
                else:
                    input = json.dumps(args[0], cls=SerializableWithStringFallback)
            elif len(args) > 0:
                input = json.dumps(args, cls=SerializableWithStringFallback)
            else:
                input = json.dumps(kwargs, cls=SerializableWithStringFallback)
        except Exception as e:
            if len(args) == 1:
                input = str(args[0])
            elif len(args) > 0:
                input = str(args)
            else:
                input = str(kwargs)

        with langwatch.span(
            type="rag",
            name=self.tool.name,
            input=input,
        ) as span:
            response = self.tool(*args, **kwargs)
            captured = self.context_extractor(response)
            span.update(contexts=captured, output=response)

            return response


def capture_rag_from_tool(
    tool: BaseTool, context_extractor: Callable[[Any], List[RAGChunk]]
):
    return WrappedRagTool(tool=tool, context_extractor=context_extractor)


def capture_rag_from_retriever(
    retriever: "BaseRetriever", context_extractor: Callable[["Document"], RAGChunk]
):
    if retriever.__class__.__name__ == "LangWatchTrackedRetriever":
        return retriever

    retriever_name = retriever.__class__.__name__

    class LangWatchTrackedRetriever(retriever.__class__):
        async def _aget_relevant_documents(
            self, query: str, *, run_manager: "AsyncCallbackManagerForRetrieverRun"
        ) -> List["Document"]:
            with langwatch.span(
                type="rag",
                name=retriever_name,
                input=query,
            ) as span:
                documents = await super()._aget_relevant_documents(
                    query, run_manager=run_manager
                )
                span.update(
                    contexts=[context_extractor(doc) for doc in documents],
                    output={
                        "type": "json",
                        "value": documents,
                    },
                )
                return documents

        def _get_relevant_documents(
            self, query: str, *, run_manager: "CallbackManagerForRetrieverRun"
        ) -> List["Document"]:
            with langwatch.span(
                type="rag",
                name=retriever_name,
                input=query,
            ) as span:
                documents = super()._get_relevant_documents(
                    query, run_manager=run_manager
                )
                span.update(
                    contexts=[context_extractor(doc) for doc in documents],
                    output={
                        "type": "json",
                        "value": documents,
                    },
                )
                return documents

    object.__setattr__(retriever, "__class__", LangWatchTrackedRetriever)

    return retriever


class LogDemotionFilter(logging.Filter):
    def __init__(self, module: str, message: str):
        super().__init__()
        self.module = module
        self.message = message

    def filter(self, record: logging.LogRecord) -> bool:
        if record.name == self.module and self.message in record.getMessage():
            record.levelno = logging.DEBUG  # Change the log level to DEBUG
            record.levelname = "DEBUG"

            # Check the log level for the logger is debug or not
            logger = logging.getLogger(self.module)
            return logger.isEnabledFor(logging.DEBUG)
        return True
