import langwatch  # +
from langchain.tools import tool
from langchain.chat_models import init_chat_model
from langchain.messages import (
    AnyMessage,
    SystemMessage,
    HumanMessage,
    ToolMessage,
)
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, START, END
from typing_extensions import TypedDict, Annotated
import operator


langwatch.setup()  # +


@tool
def add(a: int, b: int) -> int:
    """Adds two integers and returns the result."""
    return a + b


# Model with tools
model = init_chat_model("gpt-4o-mini", temperature=0)
tools = [add]
tools_by_name = {t.name: t for t in tools}
model_with_tools = model.bind_tools(tools)


class MessagesState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]


def llm_call(state: dict):
    """LLM decides whether to call a tool or not."""
    msg = model_with_tools.invoke(
        [
            SystemMessage(
                content=(
                    "You are a helpful assistant that can do small arithmetic using tools when needed."
                )
            )
        ]
        + state["messages"],
        config=RunnableConfig(
            callbacks=[langwatch.get_current_trace().get_langchain_callback()]  # +
        ),
    )
    return {"messages": [msg]}


def tool_node(state: dict):
    """Performs the tool call and returns observations as ToolMessages."""
    last = state["messages"][-1]
    results = [
        ToolMessage(
            content=tools_by_name[c["name"]].invoke(c["args"]),
            tool_call_id=c["id"],
        )
        for c in last.tool_calls
    ]
    return {"messages": results}


def should_continue(state: MessagesState):
    """Route to tool node if there are tool calls; otherwise end."""
    return "tool_node" if getattr(state["messages"][-1], "tool_calls", None) else END


# Build the graph
agent_builder = StateGraph(MessagesState)
agent_builder.add_node("llm_call", llm_call)
agent_builder.add_node("tool_node", tool_node)
agent_builder.add_edge(START, "llm_call")
agent_builder.add_conditional_edges("llm_call", should_continue, ["tool_node", END])
agent_builder.add_edge("tool_node", "llm_call")

# Compile to a runnable agent
agent = agent_builder.compile()


@langwatch.trace(name="LangGraph - Calculator Agent")  # +
def main(user_question: str) -> str:
    result = agent.invoke({"messages": [HumanMessage(content=user_question)]})
    final_msg = result["messages"][-1]  # assistant reply
    return getattr(final_msg, "content", str(final_msg))


if __name__ == "__main__":
    print(main("Add 13 and 37."))
