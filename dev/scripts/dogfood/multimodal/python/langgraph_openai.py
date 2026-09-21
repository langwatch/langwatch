"""A minimal LangGraph graph with one model node, traced through LangWatch's
LangChain callback handler.

    uv run --with langwatch --with langchain --with langgraph --with langchain-openai python langgraph_openai.py

Image only. The callback is passed into the node's `RunnableConfig`, so the
model call becomes a span nested under the trace. The image goes in an
`image_url` content block, the shape Chat Completions accepts.
"""

import operator
from typing import Annotated

from _common import attachment, data_url, question, report, require
from typing_extensions import TypedDict

import langwatch
from langchain.chat_models import init_chat_model
from langchain.messages import AnyMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

MODEL = "gpt-5-mini"


class MessagesState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]


model = init_chat_model(MODEL, temperature=0)


def llm_call(state: MessagesState):
    """Sends the accumulated messages to the model, callback attached."""
    msg = model.invoke(
        state["messages"],
        config=RunnableConfig(
            callbacks=[langwatch.get_current_trace().get_langchain_callback()]
        ),
    )
    return {"messages": [msg]}


graph_builder = StateGraph(MessagesState)
graph_builder.add_node("llm_call", llm_call)
graph_builder.add_edge(START, "llm_call")
graph_builder.add_edge("llm_call", END)
agent = graph_builder.compile()


@langwatch.trace(name="langgraph openai")
def ask() -> str:
    langwatch.get_current_trace().update(
        metadata={"labels": ["multimodal-dogfood", "langgraph-openai", "image"]},
    )

    path, media_type = attachment("image")
    message = HumanMessage(
        content=[
            {"type": "text", "text": question("image")},
            {"type": "image_url", "image_url": {"url": data_url(path, media_type)}},
        ]
    )
    result = agent.invoke({"messages": [message]})
    final_msg = result["messages"][-1]
    return getattr(final_msg, "content", str(final_msg))


if __name__ == "__main__":
    require("OPENAI_API_KEY", "LANGWATCH_API_KEY")
    langwatch.setup()
    report("langgraph-openai/image", ask())
