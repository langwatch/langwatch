from typing import Any, Dict, List, Literal, Optional, Union, cast
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
from langwatch.tracer import BaseContextTracer
from langwatch.types import (
    BaseSpan,
    ChatMessage,
    ChatRole,
    SpanInput,
    SpanMetrics,
    SpanOutput,
    SpanParams,
    SpanTimestamps,
    LLMSpan,
    TypedValueChatMessages,
    TypedValueJson,
    TypedValueText,
)

from langwatch.utils import capture_exception, list_get, milliseconds_timestamp
from uuid import UUID


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
        role = "function"
    else:
        role = "unknown"
    # TODO: handle function types! where is the name?
    return ChatMessage(role=role, content=message.content)


class LangChainTracer(BaseContextTracer, BaseCallbackHandler):
    """Base callback handler that can be used to handle callbacks from langchain."""

    def __init__(self, trace_id: Optional[str] = None) -> None:
        super().__init__(trace_id)

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
        input: SpanInput,
        **kwargs: Any,
    ):
        return LLMSpan(
            type="llm",
            span_id=f"span_{run_id}",
            parent_id=f"span_{parent_run_id}" if parent_run_id else None,
            trace_id=self.trace_id,
            vendor=list_get(serialized.get("id", []), 2, "unknown").lower(),
            model=kwargs.get("invocation_params", {}).get("model_name", "unknown"),
            input=input,
            timestamps=SpanTimestamps(started_at=milliseconds_timestamp()),
            params=SpanParams(
                stream=kwargs.get("invocation_params", {}).get("stream", False),
                temperature=kwargs.get("invocation_params", {}).get(
                    "temperature", None
                ),
            ),
        )

    def on_llm_new_token(self, token: str, **kwargs: Any) -> Any:
        pass

    def on_llm_end(self, response: LLMResult, *, run_id: UUID, **kwargs: Any) -> Any:
        span = cast(Optional[LLMSpan], self.spans.get(str(run_id)))
        if span == None:
            return
        if "timestamps" in span and span["timestamps"]:
            span["timestamps"]["finished_at"] = milliseconds_timestamp()

        outputs: List[SpanOutput] = []
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
        span["outputs"] = outputs
        span["raw_response"] = f"{type(response).__name__}({str(response)})"
        if response.llm_output and "token_usage" in response.llm_output:
            usage = response.llm_output["token_usage"]
            span["metrics"] = SpanMetrics(
                prompt_tokens=usage.get("prompt_tokens"),
                completion_tokens=usage.get("completion_tokens"),
            )

    def on_llm_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> Any:
        span = self.spans.get(str(run_id))
        if span == None:
            return
        span["error"] = capture_exception(error)

    def on_chain_start(
        self,
        serialized: Dict[str, Any],
        inputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: UUID,
        name: Optional[str],
        **kwargs: Any,
    ) -> Any:
        self.spans[str(run_id)] = self._build_base_span(
            type="chain",
            run_id=run_id,
            parent_run_id=parent_run_id,
            name=name if name else list_get(serialized.get("id", ""), -1, None),
        )

    def on_chain_end(
        self, outputs: Dict[str, Any], *, run_id: UUID, **kwargs: Any
    ) -> Any:
        self._end_base_span(
            run_id, outputs=[TypedValueJson(type="json", value=outputs)]
        )

    def on_chain_error(
        self, error: BaseException, *, run_id: UUID, **kwargs: Any
    ) -> Any:
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
        )

    def _build_base_span(
        self,
        type: Literal["span", "chain", "tool", "agent"],
        run_id: UUID,
        parent_run_id: Optional[UUID],
        name: Optional[str],
    ) -> BaseSpan:
        return BaseSpan(
            type=type,
            name=name,
            span_id=f"span_{run_id}",
            parent_id=f"span_{parent_run_id}" if parent_run_id else None,
            trace_id=self.trace_id,
            outputs=[],
            error=None,
            timestamps=SpanTimestamps(started_at=milliseconds_timestamp()),
        )

    def _end_base_span(self, run_id: UUID, outputs: List[SpanOutput]):
        span = self.spans.get(str(run_id))
        if span == None:
            return

        if "timestamps" in span and span["timestamps"]:
            span["timestamps"]["finished_at"] = milliseconds_timestamp()
        span["outputs"] = outputs

    def _on_error_base_span(self, run_id: UUID, error: BaseException):
        span = self.spans.get(str(run_id))
        if span == None:
            return
        span["error"] = capture_exception(error)

    def on_tool_end(
        self,
        output: str,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> Any:
        self._end_base_span(run_id, outputs=[TypedValueText(type="text", value=output)])

    def on_tool_error(
        self, error: BaseException, *, run_id: UUID, **kwargs: Any
    ) -> Any:
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
        self.spans[str(run_id)] = self._build_base_span(
            type="agent",
            run_id=run_id,
            parent_run_id=parent_run_id,
            name=action.tool,
        )

    def on_agent_finish(
        self,
        finish: AgentFinish,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        self._end_base_span(
            run_id, outputs=[TypedValueJson(type="json", value=finish.return_values)]
        )
