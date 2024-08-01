import json
from typing import Any, Callable, Dict, List, Literal, Optional, Union
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
from langchain.callbacks.base import BaseCallbackHandler
import nanoid
import langwatch
from langwatch.tracer import (
    ContextTrace,
    ContextSpan,
)
from langwatch.types import (
    ChatMessage,
    ChatRole,
    LLMSpanParams,
    RAGChunk,
    SpanInputOutput,
    LLMSpanMetrics,
    SpanTimestamps,
    TraceMetadata,
    TypedValueChatMessages,
    TypedValueJson,
    TypedValueList,
    TypedValueText,
)

from langwatch.utils import (
    SerializableWithStringFallback,
    autoconvert_typed_values,
    list_get,
    milliseconds_timestamp,
)
from uuid import UUID
from langchain.tools import BaseTool
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

    trace: ContextTrace

    spans: Dict[str, ContextSpan] = {}

    def __init__(
        self,
        trace: Optional[ContextTrace] = None,
        # Deprecated: mantained for retrocompatibility
        trace_id: Optional[str] = None,
        # Deprecated: mantained for retrocompatibility
        metadata: Optional[TraceMetadata] = None,
    ) -> None:
        if trace:
            self.trace = trace
        else:
            self.trace = langwatch.trace(
                trace_id=trace_id or nanoid.generate(), metadata=metadata
            )

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
    ) -> ContextSpan:
        span_params = LLMSpanParams()
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
            span_id=f"span_{run_id}",
            parent=self.spans.get(str(parent_run_id), None) if parent_run_id else None,
            trace=self.trace,
            model=(vendor + "/" + model),
            input=input,
            timestamps=SpanTimestamps(started_at=milliseconds_timestamp()),
            params=span_params,
        )
        span.__enter__()

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
                metrics=LLMSpanMetrics(
                    prompt_tokens=usage.get("prompt_tokens"),
                    completion_tokens=usage.get("completion_tokens"),
                )
            )
        span.__exit__()

    def on_llm_error(self, error: Exception, *, run_id: UUID, **kwargs: Any) -> Any:
        span = self.spans.get(str(run_id))
        if span == None:
            return

        span.__exit__(None, error)

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
    ) -> ContextSpan:
        span = langwatch.span(
            type=type,
            name=name,
            span_id=f"span_{run_id}",
            parent=self.spans.get(str(parent_run_id), None) if parent_run_id else None,
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
        span.__exit__()

    def _on_error_base_span(self, run_id: UUID, error: Exception):
        span = self.spans.get(str(run_id))
        if span == None:
            return
        span.__exit__(None, error)

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
            return autoconvert_typed_values(output)


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
    retriever: BaseRetriever, context_extractor: Callable[[Document], RAGChunk]
):
    if retriever.__class__.__name__ == "LangWatchTrackedRetriever":
        return retriever

    retriever_name = retriever.__class__.__name__

    class LangWatchTrackedRetriever(retriever.__class__):
        async def _aget_relevant_documents(
            self, query: str, *, run_manager: AsyncCallbackManagerForRetrieverRun
        ) -> List[Document]:
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
            self, query: str, *, run_manager: CallbackManagerForRetrieverRun
        ) -> List[Document]:
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
