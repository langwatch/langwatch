from dotenv import load_dotenv

load_dotenv()

from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from typing import TypedDict


class State(TypedDict):
    messages: list
    response: str


llm = ChatOpenAI(model="gpt-4o")


SYSTEM_PROMPT = "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis."


def agent_node(state: State) -> State:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *state["messages"]]
    response = llm.invoke(messages)
    return {"messages": state["messages"], "response": response.content}


graph = StateGraph(State)
graph.add_node("agent", agent_node)
graph.set_entry_point("agent")
graph.add_edge("agent", END)

app = graph.compile()

result = app.invoke({"messages": [{"role": "user", "content": "Hello!"}], "response": ""})
print(result["response"])
