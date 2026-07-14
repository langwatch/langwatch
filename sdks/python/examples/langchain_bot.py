from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()

import chainlit as cl
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import Runnable, RunnableConfig

import langwatch


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
@langwatch.trace()
async def main(message: cl.Message):
    runnable: Runnable = cl.user_session.get("runnable")  # type: ignore

    msg = cl.Message(content="")

    langwatch.get_current_trace().update(
        metadata={"customer_id": "customer_example", "labels": ["langchain"]}
    )

    async for chunk in runnable.astream(
        {"question": message.content},
        config=RunnableConfig(
            callbacks=[
                langwatch.get_current_trace().get_langchain_callback(),
            ]
        ),
    ):
        await msg.stream_token(chunk)

    await msg.send()
