from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()

import chainlit as cl
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import Runnable, RunnableConfig
from langchain_core.messages import HumanMessage, AIMessage

import langwatch


# Store message history per session
session_message_histories: dict = {}


@cl.on_chat_start
async def on_chat_start():
    # Initialize message history for this session
    session_id = cl.user_session.get("session_id", "default")
    message_history = session_message_histories.setdefault(session_id, [])
    
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", "You are a helpful assistant."),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{input}"),
        ]
    )
    llm = ChatOpenAI(temperature=1, model="gpt-5", max_tokens=4096)
    runnable = prompt | llm

    cl.user_session.set("runnable", runnable)
    cl.user_session.set("session_id", session_id)


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    runnable: Runnable = cl.user_session.get("runnable")  # type: ignore
    session_id = cl.user_session.get("session_id", "default")
    
    # Get message history for this session
    message_history = session_message_histories.get(session_id, [])

    msg = cl.Message(content="")

    langwatch.get_current_trace().update(
        metadata={"customer_id": "customer_example", "labels": ["langchain", "memory"]}
    )

    async for chunk in runnable.astream(
        {"input": message.content, "chat_history": message_history},
        config=RunnableConfig(
            callbacks=[
                langwatch.get_current_trace().get_langchain_callback(),
            ]
        ),
    ):
        await msg.stream_token(chunk.content)

    # Save the conversation to message history
    message_history.append(HumanMessage(content=message.content))
    message_history.append(AIMessage(content=msg.content))

    await msg.send()
