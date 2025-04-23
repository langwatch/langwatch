import asyncio
import sys

sys.path.insert(0, "../../")

import pydantic
import langchain
import openai

print("pydantic version:", pydantic.__version__)
print("langchain version:", langchain.__version__)
print("openai version:", openai.__version__)

if pydantic.__version__ != "1.10.15":
    raise ValueError("pydantic version must be 1.10.15")
if langchain.__version__ != "0.0.323":
    raise ValueError("langchain version must be 0.0.323")
if openai.__version__ != "0.28.1":
    raise ValueError("openai version must be 0.28.1")

from dotenv import load_dotenv
from langchain.chat_models.openai import ChatOpenAI

load_dotenv()

from langchain.prompts import ChatPromptTemplate
from langchain.schema import StrOutputParser
from langchain.schema.runnable import Runnable
from langchain.schema.runnable.config import RunnableConfig

import langwatch


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


@langwatch.trace()
async def main(input: str):
    langwatch.get_current_trace().update(
        metadata={"customer_id": "customer_example", "labels": ["v1.0.0"]}
    )

    async for chunk in runnable.astream(
        {"question": input},
        config=RunnableConfig(
            callbacks=[
                langwatch.get_current_trace().get_langchain_callback(),
            ]
        ),
    ):
        print(chunk, end="", flush=True)

    print("\n")
    print("legacy_langchain_pydantic_bot.py:", langwatch.get_current_trace().share())


asyncio.run(main("hello"))
