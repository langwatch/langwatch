from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
import langwatch
from pydantic import BaseModel
from agents.agent import Agent
from agents.guardrail import InputGuardrail, GuardrailFunctionOutput
from agents.run import Runner
from agents.tracing import set_trace_processors
from langsmith.integrations.openai_agents_sdk._openai_agents import OpenAIAgentsTracingProcessor
from agents.exceptions import InputGuardrailTripwireTriggered

langwatch.setup()

set_trace_processors([OpenAIAgentsTracingProcessor()])


class HomeworkOutput(BaseModel):
    is_homework: bool
    reasoning: str


guardrail_agent = Agent(
    name="Guardrail check",
    instructions="Check if the user is asking about homework.",
    output_type=HomeworkOutput,
)

math_tutor_agent = Agent(
    name="Math Tutor",
    handoff_description="Specialist agent for math questions",
    instructions="You provide help with math problems. Explain your reasoning at each step and include examples",
)

history_tutor_agent = Agent(
    name="History Tutor",
    handoff_description="Specialist agent for historical questions",
    instructions="You provide assistance with historical queries. Explain important events and context clearly.",
)


async def homework_guardrail(ctx, agent, input_data):
    result = await Runner.run(guardrail_agent, input_data, context=ctx.context)
    final_output = result.final_output_as(HomeworkOutput)
    return GuardrailFunctionOutput(
        output_info=final_output,
        tripwire_triggered=not final_output.is_homework,
    )


triage_agent = Agent(
    name="Triage Agent",
    instructions="You determine which agent to use based on the user's homework question",
    handoffs=[history_tutor_agent, math_tutor_agent],
    input_guardrails=[
        InputGuardrail(guardrail_function=homework_guardrail),
    ],
)


@cl.on_message
@langwatch.trace(name="OpenAI Agent Run with OpenInference")
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    try:
        result = await Runner.run(
            triage_agent, "who was the first president of the united states?"
        )
        await msg.stream_token(result.final_output)
    except InputGuardrailTripwireTriggered as e:
        await msg.stream_token("Guardrail blocked this input: " + str(e))

    await msg.update()
