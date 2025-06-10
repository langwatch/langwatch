import os

os.environ["CHAINLIT_AUTH_SECRET"] = (
    "sSgdH4IfqM/%5swBnuwNdZ8rS/VBDW-WiBF?>DW_YPPKm9p9CiO6PPm6Z4Ih7IL"
)

import datetime
import os.path
import pickle
from typing import Dict, List, Optional
from dotenv import load_dotenv

from langwatch.types import RAGChunk

load_dotenv()

import chainlit as cl
from langchain.prompts import ChatPromptTemplate
from langchain.schema import HumanMessage
from langchain.schema.runnable.config import RunnableConfig

import langwatch

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

loader = WebBaseLoader("https://docs.langwatch.ai")
docs = loader.load()
documents = RecursiveCharacterTextSplitter(
    chunk_size=1000, chunk_overlap=200
).split_documents(docs)
vector = FAISS.from_documents(documents, OpenAIEmbeddings())
retriever = vector.as_retriever()


now = datetime.datetime.now()

thread_history = [
    {
        "id": "test1",
        "name": "thread 1",
        "createdAt": now,
        "userId": "test",
        "userIdentifier": "admin",
        "steps": [
            {
                "id": "test1",
                "name": "test",
                "createdAt": now,
                "type": "user_message",
                "output": "Message 1",
            },
            {
                "id": "test2",
                "name": "test",
                "createdAt": now,
                "type": "assistant_message",
                "output": "Message 2",
            },
        ],
    },
    {
        "id": "test2",
        "createdAt": now,
        "userId": "test",
        "userIdentifier": "admin",
        "name": "thread 2",
        "steps": [
            {
                "id": "test3",
                "createdAt": now,
                "name": "test",
                "type": "user_message",
                "output": "Message 3",
            },
            {
                "id": "test4",
                "createdAt": now,
                "name": "test",
                "type": "assistant_message",
                "output": "Message 4",
            },
        ],
    },
]
deleted_thread_ids = []

THREAD_HISTORY_PICKLE_PATH = os.getenv("THREAD_HISTORY_PICKLE_PATH")
if THREAD_HISTORY_PICKLE_PATH and os.path.exists(THREAD_HISTORY_PICKLE_PATH):
    with open(THREAD_HISTORY_PICKLE_PATH, "rb") as f:
        thread_history = pickle.load(f)


async def save_thread_history():
    if THREAD_HISTORY_PICKLE_PATH:
        # Force saving of thread history for reload when server restarts
        await persist_user_session(
            cl.context.session.thread_id, cl.context.session.to_persistable()
        )

        with open(THREAD_HISTORY_PICKLE_PATH, "wb") as out_file:
            pickle.dump(thread_history, out_file)


class TestDataLayer(cl_data.base.BaseDataLayer):
    async def get_user(self, identifier: str):
        return cl.PersistedUser(
            id="test", createdAt=now.isoformat(), identifier=identifier
        )

    async def create_user(self, user: cl.User):
        return cl.PersistedUser(
            id="test", createdAt=now.isoformat(), identifier=user.identifier
        )

    async def update_thread(
        self,
        thread_id: str,
        name: Optional[str] = None,
        user_id: Optional[str] = None,
        metadata: Optional[Dict] = None,
        tags: Optional[List[str]] = None,
    ):
        thread = next((t for t in thread_history if t["id"] == thread_id), None)
        if thread:
            if name:
                thread["name"] = name
            if metadata:
                thread["metadata"] = metadata
            if tags:
                thread["tags"] = tags
        else:
            thread_history.append(
                {
                    "id": thread_id,
                    "name": name,
                    "metadata": metadata,
                    "tags": tags,
                    "createdAt": now.isoformat(),
                    "userId": user_id,
                    "userIdentifier": "admin",
                    "steps": [],
                }
            )

    @cl_data.queue_until_user_message()
    async def create_step(self, step_dict: StepDict):
        thread = next(
            (t for t in thread_history if t["id"] == step_dict.get("threadId")), None
        )
        if thread:
            thread["steps"].append(step_dict)

    async def get_thread_author(self, thread_id: str):
        return "admin"

    async def list_threads(
        self, pagination: Pagination, filters: ThreadFilter
    ) -> PaginatedResponse[ThreadDict]:
        return PaginatedResponse(
            data=[t for t in thread_history if t["id"] not in deleted_thread_ids],
            pageInfo=PageInfo(hasNextPage=False, startCursor=None, endCursor=None),
        )  # type: ignore

    async def get_thread(self, thread_id: str):
        thread = next((t for t in thread_history if t["id"] == thread_id), None)
        if not thread:
            return None
        thread["steps"] = sorted(thread["steps"], key=lambda x: x["createdAt"])
        return thread

    async def delete_thread(self, thread_id: str):
        deleted_thread_ids.append(thread_id)

    async def delete_feedback(
        self,
        feedback_id: str,
    ) -> bool:
        return True

    async def upsert_feedback(
        self,
        feedback: Feedback,
    ) -> str:
        return ""

    @queue_until_user_message()
    async def create_element(self, element: "Element"):
        pass

    async def get_element(
        self, thread_id: str, element_id: str
    ) -> Optional["ElementDict"]:
        pass

    @queue_until_user_message()
    async def delete_element(self, element_id: str, thread_id: Optional[str] = None):
        pass

    @queue_until_user_message()
    async def update_step(self, step_dict: "StepDict"):
        pass

    @queue_until_user_message()
    async def delete_step(self, step_id: str):
        pass

    async def build_debug_url(self) -> str:
        return ""


cl_data._data_layer = TestDataLayer()


@cl.on_chat_start
async def on_chat_start():
    retriever_tool = create_retriever_tool(
        langwatch.langchain.capture_rag_from_retriever(
            retriever,
            lambda document: RAGChunk(
                document_id=document.metadata["source"], content=document.page_content
            ),
        ),
        "langwatch_search",
        "Search for information about LangWatch. For any questions about LangWatch, use this tool if you didn't already",
    )

    # Alternative approach to retrievers
    # wrapped_tool = langwatch.langchain.capture_rag_from_tool(
    #     retriever_tool, lambda response: [RAGChunk(content=response)]
    # )

    tools = [retriever_tool]
    model = ChatOpenAI(streaming=True)
    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis and use tools only once.\n\n{agent_scratchpad}",
            ),
            ("human", "{question}"),
        ]
    )
    agent = create_tool_calling_agent(model, tools, prompt)
    executor = AgentExecutor(agent=agent, tools=tools, verbose=True)  # type: ignore
    cl.user_session.set("agent", executor)


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    agent: AgentExecutor = cl.user_session.get("agent")  # type: ignore

    msg = cl.Message(content="")

    langwatch.get_current_trace().update(
        metadata={
            "labels": ["langchain", "rag"],
            "user_id": getattr(cl.user_session.get("user"), "identifier", "unknown"),
            "thread_id": cl.context.session.thread_id,
        }
    )

    async for chunk in agent.astream(
        {
            "question": message.content,
            "messages": [HumanMessage(content="Hoi, dit is een test")],
        },
        config=RunnableConfig(
            callbacks=[
                cl.LangchainCallbackHandler(),
                langwatch.get_current_trace().get_langchain_callback(),
            ]
        ),
    ):
        if "output" in chunk:
            await msg.stream_token(chunk["output"])
        elif "actions" in chunk:
            await msg.stream_token(chunk["actions"][0].log)
        elif "steps" in chunk:
            await msg.stream_token(chunk["steps"][0].observation + "\n\n")
        else:
            await msg.stream_token("<unammaped chunk>")

    await msg.send()

    await save_thread_history()


@cl.password_auth_callback
async def auth_callback(username: str, password: str) -> Optional[cl.User]:
    if (username, password) == ("admin", "admin"):
        return cl.User(identifier="admin")
    else:
        return None


@cl.on_chat_resume
async def on_chat_resume(thread: ThreadDict):
    await cl.Message(f"Welcome back to {thread['name']}").send()
    if "metadata" in thread and thread["metadata"]:
        await cl.Message(thread["metadata"], author="metadata", language="json").send()
    if "tags" in thread and thread["tags"]:
        await cl.Message(
            ",".join(thread["tags"]), author="tags", language="json"
        ).send()
