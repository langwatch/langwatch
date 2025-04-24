import sys
import subprocess


def install(package):
    subprocess.check_call([sys.executable, "-m", "pip", "install", package])


try:
    import crewai
    from openinference.instrumentation.crewai import CrewAIInstrumentor
    import duckduckgo_search
except ImportError:
    # Poetry doesn't allow installing crewai without increasing the min python version to 3.10, so we install it manually
    print("Installing crewai...")
    install("crewai")
    install("openinference-instrumentation-crewai")
    install("duckduckgo-search")
    print("crewai installed successfully.")

from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
import langwatch
from crewai import Agent, Task, Crew

import os
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor
from openinference.instrumentation.crewai import CrewAIInstrumentor
from openinference.instrumentation.langchain import LangChainInstrumentor
from openinference.instrumentation import using_attributes

# Set up OpenTelemetry trace provider with LangWatch as the endpoint
tracer_provider = trace_sdk.TracerProvider()
tracer_provider.add_span_processor(
    SimpleSpanProcessor(
        OTLPSpanExporter(
            endpoint=f"{langwatch.endpoint}/api/otel/v1/traces",
            headers={"Authorization": "Bearer " + os.environ["LANGWATCH_API_KEY"]},
        )
    )
)
# Optionally, you can also print the spans to the console.
tracer_provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))


CrewAIInstrumentor().instrument(tracer_provider=tracer_provider)
LangChainInstrumentor().instrument(tracer_provider=tracer_provider)

from langchain_community.tools import DuckDuckGoSearchRun

search_tool = DuckDuckGoSearchRun()

agent1 = Agent(
    llm="openai/gpt-4o-mini",
    role="first agent",
    goal="who is {input}?",
    backstory="agent backstory",
    verbose=True,
    tools=[search_tool],
)

task1 = Task(
    expected_output="a short biography of {input}",
    description="a short biography of {input}",
    agent=agent1,
)

agent2 = Agent(
    llm="openai/gpt-4o-mini",
    role="second agent",
    goal="summarize the short bio for {input} and if needed do more research",
    backstory="agent backstory",
    verbose=True,
)

task2 = Task(
    description="a tldr summary of the short biography",
    expected_output="5 bullet point summary of the biography",
    agent=agent2,
    context=[task1],
)

my_crew = Crew(agents=[agent1, agent2], tasks=[task1, task2])


@cl.on_message
async def main(message: cl.Message):
    with using_attributes(
        user_id="123",
        tags=["tag-1", "tag-2"],
    ):
        msg = cl.Message(
            content="",
        )

        crew = my_crew.kickoff(inputs={"input": message.content})

        await msg.stream_token(str(crew.raw))

        await msg.update()
