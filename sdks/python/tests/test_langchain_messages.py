import json

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from langwatch.langchain import langchain_message_to_chat_message
from langwatch.utils.transformation import SerializableWithStringFallback


# @scenario A chain input holding LangChain messages keeps each message's role
def test_chain_input_messages_keep_their_roles():
    inputs = {
        "messages": [
            SystemMessage(content="You are a helpful travel agent."),
            HumanMessage(content="What is the weather in Paris?"),
            AIMessage(content="It is sunny."),
            ToolMessage(content="Sunny, 22C", tool_call_id="call_1"),
        ]
    }

    serialised = json.loads(json.dumps(inputs, cls=SerializableWithStringFallback))

    assert [message["role"] for message in serialised["messages"]] == [
        "system",
        "user",
        "assistant",
        "tool",
    ]
    assert serialised["messages"][1]["content"] == "What is the weather in Paris?"


# @scenario An AI message's tool calls and a tool message's call id are kept
def test_tool_calls_and_tool_call_id_are_kept():
    ai = AIMessage(
        content="",
        tool_calls=[{"name": "get_weather", "args": {"city": "Paris"}, "id": "call_1"}],
    )
    tool = ToolMessage(content="Sunny, 22C", tool_call_id="call_1", name="get_weather")

    assert langchain_message_to_chat_message(ai)["tool_calls"] == [
        {
            "id": "call_1",
            "type": "function",
            "function": {"name": "get_weather", "arguments": '{"city": "Paris"}'},
        }
    ]
    assert langchain_message_to_chat_message(tool) == {
        "role": "tool",
        "content": "Sunny, 22C",
        "tool_call_id": "call_1",
        "name": "get_weather",
    }
