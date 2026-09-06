from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()

import chainlit as cl
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.schema.runnable import Runnable, RunnableMap
from langchain.schema.runnable.config import RunnableConfig
from langchain.memory import ConversationBufferMemory


session_memories: dict = {}


@cl.on_chat_start
async def on_chat_start():
    memory = session_memories.setdefault(
        cl.user_session.get("session_id"),
        ConversationBufferMemory(return_messages=True, memory_key="chat_history"),
    )
    ingress = RunnableMap(
        {
            "input": lambda x: x["input"],
            "chat_history": lambda x: memory.load_memory_variables(x)["chat_history"],
        }
    )
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", "You are a helpful assistant."),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{input}"),
        ]
    )
    llm = ChatOpenAI(temperature=0.3, model="gpt-5", max_tokens=4096)
    runnable = ingress | prompt | llm

    cl.user_session.set("runnable", runnable)
    cl.user_session.set("memory", memory)


@cl.on_message
async def main(message: cl.Message):
    runnable: Runnable = cl.user_session.get("runnable")  # type: ignore
    memory = cl.user_session.get("memory")  # type: ignore

    msg = cl.Message(content="")

    async for chunk in runnable.astream(
        {"input": message.content},
        config=RunnableConfig(
            callbacks=[
                cl.LangchainCallbackHandler(),
            ]
        ),
    ):
        await msg.stream_token(chunk.content)

    memory.save_context({"input": message.content}, {"output": msg.content})  # type: ignore

    await msg.send()
