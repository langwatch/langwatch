"""
Hello World Scenario Test for OpenAI Agents SDK

This example demonstrates how to wrap OpenAI Agents SDK agents
with Scenario's AgentAdapter for automated testing.
"""

from dotenv import load_dotenv
import pytest
import scenario
from scenario import AgentInput, AgentReturnTypes
from agents.agent import Agent
from agents.run import Runner

from examples.openai_sdk import triage_agent

load_dotenv()


# 1️⃣ Create an AgentAdapter that wraps your OpenAI Agent
class OpenAIAgentAdapter(scenario.AgentAdapter):
    """Adapter to make OpenAI Agents SDK compatible with Scenario testing"""

    def __init__(self, agent: Agent):
        self.agent = triage_agent

    async def call(self, input: AgentInput) -> AgentReturnTypes:
        """
        Convert Scenario's message format to OpenAI Agent format,
        run the agent, and return the result.
        """
        # Get the last user message as a simple string
        user_message = input.last_new_user_message_str()

        # Run the OpenAI agent
        result = await Runner.run(self.agent, user_message)

        # Return the agent's response as a string
        return result.final_output


# 2️⃣ Create a simple test agent
math_tutor = Agent(
    name="Math Tutor",
    instructions="You are a helpful math tutor. Provide clear, concise answers to math questions.",
)

# 3️⃣ Wrap it with the adapter
math_tutor_adapter = OpenAIAgentAdapter(math_tutor)


# 4️⃣ Run a simple hello world scenario test
@pytest.mark.asyncio
async def test_hello_world():
    """Simple hello world test to verify the agent responds appropriately"""

    await scenario.run(
        name="Math tutor hello world",
        description="User asks a simple math question and expects a helpful response",
        agents=[
            math_tutor_adapter,
            scenario.UserSimulatorAgent(model="gpt-4o-mini"),
            scenario.JudgeAgent(
                model="gpt-4o-mini",
                criteria=[
                    "Agent provides a clear answer to the math question",
                    "Agent is friendly and helpful",
                ],
            ),
        ],
        script=[
            scenario.user("What is 2 + 2?"),
            scenario.agent(),
            scenario.judge(),
        ],
    )
