import json
from typing import Any, Dict, List, Optional, Union, cast
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
from langwatch.tracer import send_spans
from langwatch.types import (
    ChatMessage,
    ChatRole,
    SpanMetrics,
    SpanOutput,
    SpanParams,
    SpanTimestamps,
    LLMSpan,
    TypedValueChatMessages,
    TypedValueText,
)
import nanoid

from langwatch.utils import list_get, milliseconds_timestamp
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


class LangWatchCallback(BaseCallbackHandler):
    """Base callback handler that can be used to handle callbacks from langchain."""

    def __init__(self, trace_id: Optional[str] = None) -> None:
        super().__init__()
        self.spans: Dict[UUID, LLMSpan] = {}
        self.trace_id = trace_id or f"trace_{nanoid.generate()}"

    def on_llm_start(
        self, serialized: Dict[str, Any], prompts: List[str], **kwargs: Any
    ) -> Any:
        raise NotImplementedError

    def on_chat_model_start(
        self,
        serialized: Dict[str, Any],
        messages: List[List[BaseMessage]],
        run_id: UUID,
        **kwargs: Any,
    ) -> Any:
        self.spans[run_id] = LLMSpan(
            type="llm",
            # span_id=run_id, # TODO
            # parent_id=parent_run_id, # TODO
            trace_id=self.trace_id,
            vendor=list_get(serialized.get("id", []), 2, "unknown").lower(),
            model=kwargs.get("invocation_params", {}).get("model_name", "unknown"),
            input=TypedValueChatMessages(
                type="chat_messages",
                value=langchain_messages_to_chat_messages(messages),
            ),
            timestamps=SpanTimestamps(started_at=milliseconds_timestamp()),
            params=SpanParams(
                stream=kwargs.get("invocation_params", {}).get("stream", False),
                temperature=kwargs.get("invocation_params", {}).get(
                    "temperature", None
                ),
            ),
        )

    def on_llm_new_token(self, token: str, **kwargs: Any) -> Any:
        print("NOT IMPLEMENTED YET on_llm_new_token")

    def on_llm_end(self, response: LLMResult, *, run_id: UUID, **kwargs: Any) -> Any:
        span = self.spans[run_id]
        if "timestamps" in span:
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

    def on_llm_error(
        self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> Any:
        print("NOT IMPLEMENTED YET on_llm_error")

    def on_chain_start(
        self,
        serialized: Dict[str, Any],
        inputs: Dict[str, Any],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> Any:
        pass

    def on_chain_end(self, outputs: Dict[str, Any], run_id: UUID, **kwargs: Any) -> Any:
        send_spans(list(self.spans.values()))

    def on_chain_error(
        self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> Any:
        print("NOT IMPLEMENTED YET on_chain_error")

    def on_tool_start(
        self, serialized: Dict[str, Any], input_str: str, **kwargs: Any
    ) -> Any:
        print("NOT IMPLEMENTED YET on_tool_start")

    def on_tool_end(self, output: str, **kwargs: Any) -> Any:
        print("NOT IMPLEMENTED YET on_tool_end")

    def on_tool_error(
        self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> Any:
        print("NOT IMPLEMENTED YET on_tool_error")

    def on_text(self, text: str, **kwargs: Any) -> Any:
        pass

    def on_agent_action(self, action: AgentAction, **kwargs: Any) -> Any:
        print("NOT IMPLEMENTED YET on_agent_action")

    def on_agent_finish(self, finish: AgentFinish, **kwargs: Any) -> Any:
        print("NOT IMPLEMENTED YET on_agent_finish")
