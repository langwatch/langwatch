# This example uses the OpenTelemetry instrumentation for OpenAI from OpenLLMetry: https://pypi.org/project/opentelemetry-instrumentation-openai/

from datetime import datetime
from typing import Optional, cast
from dotenv import load_dotenv

import langwatch

load_dotenv()

import chainlit as cl

from openinference.instrumentation.openai import OpenAIInstrumentor
from openai import AsyncOpenAI, AsyncAssistantEventHandler


client = AsyncOpenAI()

langwatch.setup(
    instrumentors=[OpenAIInstrumentor()],
)


@cl.on_chat_start
async def on_chat_start():
    assistant = await client.beta.assistants.create(
        name="Math Tutor",
        instructions="You are a personal math tutor. Write and run code to answer math questions.",
        tools=[{"type": "code_interpreter"}],
        model="gpt-4o-mini",
    )

    thread = await client.beta.threads.create()

    cl.user_session.set("thread_id", thread.id)
    cl.user_session.set("assistant_id", assistant.id)
    cl.user_session.set("assistant_name", assistant.name)


class EventHandler(AsyncAssistantEventHandler):
    def __init__(self, assistant_name: str) -> None:
        super().__init__()
        self.current_message: Optional[cl.Message] = None
        self.current_step: Optional[cl.Step] = None
        self.current_tool_call = None
        self.assistant_name = assistant_name

    async def on_text_created(self, text) -> None:
        self.current_message = cl.Message(author=self.assistant_name, content="")
        await self.current_message.send()

    async def on_text_delta(self, delta, snapshot):
        if self.current_message:
            await self.current_message.stream_token(delta.value or "")

    async def on_text_done(self, text):
        if self.current_message:
            await self.current_message.update()

    async def on_tool_call_created(self, tool_call):
        self.current_tool_call = tool_call.id
        self.current_step = cl.Step(name=tool_call.type, type="tool")
        self.current_step.language = "python"
        self.current_step.created_at = datetime.now()
        await self.current_step.send()

    async def on_tool_call_delta(self, delta, snapshot):
        if snapshot.id != self.current_tool_call:
            self.current_tool_call = snapshot.id
            self.current_step = cl.Step(name=delta.type, type="tool")
            self.current_step.language = "python"
            self.current_step.start = datetime.now()
            await self.current_step.send()

        if delta.type == "code_interpreter":
            if (
                self.current_step
                and delta.code_interpreter
                and delta.code_interpreter.outputs
            ):
                for output in delta.code_interpreter.outputs:
                    if output.type == "logs":
                        error_step = cl.Step(name=delta.type, type="tool")
                        error_step.is_error = True
                        error_step.output = output.logs
                        error_step.language = "markdown"
                        error_step.start = self.current_step.start
                        error_step.end = datetime.now()
                        await error_step.send()
            else:
                if (
                    self.current_step
                    and delta.code_interpreter
                    and delta.code_interpreter.input
                ):
                    await self.current_step.stream_token(delta.code_interpreter.input)

    async def on_tool_call_done(self, tool_call):
        if self.current_step:
            self.current_step.end = datetime.now()
            await self.current_step.update()


@cl.on_message
async def main(message: cl.Message):
    thread_id = cast(str, cl.user_session.get("thread_id"))
    assistant_id = cast(str, cl.user_session.get("assistant_id"))
    assistant_name = cast(str, cl.user_session.get("assistant_name"))

    await client.beta.threads.messages.create(
        thread_id=thread_id, role="user", content=message.content
    )

    async with client.beta.threads.runs.stream(
        thread_id=thread_id,
        assistant_id=assistant_id,
        instructions="Please address the user as Jane Doe. The user has a premium account.",
        event_handler=EventHandler(assistant_name=assistant_name),
    ) as stream:
        await stream.until_done()
