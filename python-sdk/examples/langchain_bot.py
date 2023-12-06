import chainlit as cl
from langchain.chains import LLMMathChain
from langchain.llms import OpenAI
from langchain.chat_models import ChatOpenAI
from langchain.prompts import PromptTemplate, ChatPromptTemplate
from langchain.schema import StrOutputParser
from langchain.schema.runnable import Runnable
from langchain.schema.runnable.config import RunnableConfig

import sys

sys.path.append("..")
import langwatch.langchain


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

    with langwatch.langchain.LangChainTracer() as langWatchCallback:
        async for chunk in runnable.astream(
            {"question": message.content},
            config=RunnableConfig(
                callbacks=[cl.LangchainCallbackHandler(), langWatchCallback]
            ),
        ):
            await msg.stream_token(chunk)

    await msg.send()
