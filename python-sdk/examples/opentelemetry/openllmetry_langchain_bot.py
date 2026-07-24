from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

import langwatch

load_dotenv()

import chainlit as cl
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import Runnable, RunnableConfig

from opentelemetry.instrumentation.langchain import LangchainInstrumentor

langwatch.setup(
    instrumentors=[LangchainInstrumentor()],
)


@cl.on_chat_start
async def on_chat_start():
    model = ChatOpenAI(streaming=True)
    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
            ),
            ("human", "{question}"),
        ]
    )
    runnable = prompt | model | StrOutputParser()
    cl.user_session.set("runnable", runnable)


@cl.on_message
async def main(message: cl.Message):
    runnable: Runnable = cl.user_session.get("runnable")  # type: ignore

    msg = cl.Message(content="")

    async for chunk in runnable.astream(
        {"question": message.content},
        config=RunnableConfig(
            metadata={
                "user_id": "123",
                "thread_id": "789",
                "customer_id": "456",
                "labels": ["langchain", "thread"],
            },
        ),
    ):
        await msg.stream_token(chunk)

    await msg.send()
