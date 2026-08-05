from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
from openai import OpenAI

client = OpenAI()

import langwatch

import json


@langwatch.span(type="tool")
def get_weather(city: str):
    return "27°C and sunny"


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    langwatch.get_current_trace().autotrack_openai_calls(client)
    langwatch.get_current_trace().update(
        metadata={"labels": ["openai", "tools"]},
    )

    msg = cl.Message(
        content="",
    )

    completion = client.chat.completions.create(
        model="gpt-5-mini",
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
        # gpt-5-mini refuses a FORCED function tool_choice outright
        # (400 invalid_prompt, pointing at the reasoning-model prompting
        # guide), so the example relies on "auto" picking the tool for a
        # weather question.
        tool_choice="auto",
    )

    # "auto" does not guarantee a tool call: bail out with the model's
    # text answer instead of crashing on tool_calls[0].
    if not completion.choices[0].message.tool_calls:
        await msg.stream_token(completion.choices[0].message.content or "")
        await msg.update()
        return

    tool_message = completion.choices[0].message.tool_calls[0]  # type: ignore
    weather_call = json.loads(tool_message.function.arguments)  # type: ignore

    weather = get_weather(weather_call["city"])

    completion = client.chat.completions.create(
        model="gpt-5-mini",
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
