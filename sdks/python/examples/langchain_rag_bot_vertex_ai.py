import json
import os
import tempfile
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
from langchain_google_vertexai import ChatVertexAI, VertexAI

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

    try:
        credentials_json = json.loads(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
        credentials_file = tempfile.NamedTemporaryFile(mode="w", delete=False)
        credentials_file.write(json.dumps(credentials_json))
        credentials_file.close()

        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_file.name
    except:
        pass

    tools = [retriever_tool]
    model = ChatVertexAI(
        model_name="gemini-1.5-flash-001",
        project=os.environ["VERTEXAI_PROJECT"],
        location=os.environ["VERTEXAI_LOCATION"],
        streaming=True,
    )

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
        metadata={"customer_id": "customer_example", "labels": ["langchain", "rag", "vertex_ai"]}
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
