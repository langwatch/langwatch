from dotenv import load_dotenv

load_dotenv()

from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from typing import TypedDict


class State(TypedDict):
    messages: list
    response: str


llm = ChatOpenAI(model="gpt-4o")


def agent_node(state: State) -> State:
    response = llm.invoke(state["messages"])
    return {"messages": state["messages"], "response": response.content}


graph = StateGraph(State)
graph.add_node("agent", agent_node)
graph.set_entry_point("agent")
graph.add_edge("agent", END)

app = graph.compile()

result = app.invoke({"messages": [{"role": "user", "content": "Hello!"}], "response": ""})
print(result["response"])
