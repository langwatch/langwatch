from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
from openai import OpenAI
from openai.types.chat import ChatCompletionMessage

client = OpenAI()

import sys

sys.path.append("..")
import langwatch.openai

import json


def get_weather(city: str):
    return "27°C and sunny"


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    with langwatch.openai.OpenAITracer(client):
        completion = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that calls tools that gives weather predictions.",
                },
                {"role": "user", "content": message.content},
            ],
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "description": "Get the weather for a city.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "city": {
                                    "type": "string",
                                    "description": "The city to get the weather for.",
                                },
                            },
                            "required": ["city"],
                        },
                    },
                }
            ],
            tool_choice={
                "type": "function",
                "function": {
                    "name": "get_weather",
                },
            },
        )

        tool_message = completion.choices[0].message.tool_calls[0]  # type: ignore
        weather_call = json.loads(tool_message.function.arguments)  # type: ignore

        with langwatch.create_span(
            "get_weather", type="tool", input=weather_call
        ) as span:
            weather = get_weather(weather_call["city"])
            span.output = weather

        completion = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that gives weather predictions based on the tool results.",
                },
                {"role": "user", "content": message.content},
                completion.choices[0].message,
                {"tool_call_id": tool_message.id, "role": "tool", "name": tool_message.function.name, "content": weather},  # type: ignore
            ],
            stream=True,
        )

    for part in completion:
        if token := part.choices[0].delta.content or "":
            await msg.stream_token(token)

    await msg.update()
