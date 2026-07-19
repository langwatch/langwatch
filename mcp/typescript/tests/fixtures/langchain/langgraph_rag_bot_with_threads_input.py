import os

os.environ["CHAINLIT_AUTH_SECRET"] = (
    "sSgdH4IfqM/%5swBnuwNdZ8rS/VBDW-WiBF?>DW_YPPKm9p9CiO6PPm6Z4Ih7IL"
)

import datetime
import os.path
import pickle
from typing import Dict, List, Literal, Optional
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
from langchain.prompts import ChatPromptTemplate
from langchain.schema import HumanMessage
from langchain.schema.runnable.config import RunnableConfig

from langchain_community.document_loaders import WebBaseLoader
from langchain_community.vectorstores.faiss import FAISS
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain.tools.retriever import create_retriever_tool
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain.tools import BaseTool, StructuredTool, tool
import chainlit as cl
import chainlit.data as cl_data
from chainlit.data.utils import queue_until_user_message
from chainlit.element import Element, ElementDict
from chainlit.socket import persist_user_session
from chainlit.step import StepDict
from chainlit.types import (
    Feedback,
    PageInfo,
    PaginatedResponse,
    Pagination,
    ThreadDict,
    ThreadFilter,
)
from langgraph.graph import StateGraph, START, END, MessagesState
from langgraph.prebuilt import ToolNode
from langgraph.graph.state import CompiledStateGraph

loader = WebBaseLoader("https://docs.langwatch.ai")
docs = loader.load()
documents = RecursiveCharacterTextSplitter(
    chunk_size=1000, chunk_overlap=200
).split_documents(docs)
vector = FAISS.from_documents(documents, OpenAIEmbeddings())
retriever = vector.as_retriever()


@cl.on_chat_start
async def on_chat_start():
    retriever_tool = create_retriever_tool(
        retriever,
        "langwatch_search",
        "Search for information about LangWatch. For any questions about LangWatch, use this tool if you didn't already",
    )

    tools = [retriever_tool]
    model = ChatOpenAI(model="gpt-5", streaming=True)

    # Create LangGraph workflow
    def should_continue(state: MessagesState) -> Literal["tools", END]:
        messages = state['messages']
        last_message = messages[-1]
        if last_message.tool_calls:
            return "tools"
        return END

    def call_model(state: MessagesState):
        messages = state['messages']
        response = model.invoke(messages)
        return {"messages": [response]}

    workflow = StateGraph(MessagesState)
    workflow.add_node("agent", call_model)
    workflow.add_node("tools", ToolNode(tools))
    workflow.add_edge(START, "agent")
    workflow.add_conditional_edges("agent", should_continue)
    workflow.add_edge("tools", "agent")

    app = workflow.compile()
    cl.user_session.set("agent", app)


@cl.on_message
async def main(message: cl.Message):
    agent: CompiledStateGraph = cl.user_session.get("agent")  # type: ignore

    msg = cl.Message(content="")

    async for chunk in agent.astream(
        {"messages": [HumanMessage(content=message.content)]},
        config=RunnableConfig(
            callbacks=[
                cl.LangchainCallbackHandler(),
            ]
        ),
    ):
        if "agent" in chunk:
            await msg.stream_token(chunk["agent"]["messages"][-1].content)

    await msg.send()
