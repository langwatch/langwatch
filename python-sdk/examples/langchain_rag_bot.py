from dotenv import load_dotenv

from langwatch.types import RAGChunk

load_dotenv()

import chainlit as cl
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from langchain.agents import create_agent

import langwatch

from langchain_community.document_loaders import WebBaseLoader
from langchain_community.vectorstores.faiss import FAISS
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.tools import create_retriever_tool

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
    model = ChatOpenAI(model="gpt-5", streaming=True)

    agent = create_agent(
        model=model,
        tools=tools,
        system_prompt="You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis and use tools only once."
    )
    cl.user_session.set("agent", agent)


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    agent = cl.user_session.get("agent")  # type: ignore

    msg = cl.Message(content="")

    langwatch.get_current_trace().update(
        metadata={"user_id": "user_example", "labels": ["langchain", "rag"]}
    )

    async for chunk in agent.astream(
        {"messages": [HumanMessage(content=message.content)]},
        config=RunnableConfig(
            callbacks=[
                langwatch.get_current_trace().get_langchain_callback(),
            ]
        ),
    ):
        # In v1, create_agent streams message chunks differently
        if "model" in chunk:
            # This is the model response chunk
            model_chunk = chunk["model"]
            if hasattr(model_chunk, "content") and model_chunk.content:
                await msg.stream_token(model_chunk.content)

    await msg.send()
