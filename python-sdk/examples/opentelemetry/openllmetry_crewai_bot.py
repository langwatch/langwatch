"""
CrewAI Integration Examples with OpenLLMetry and LangWatch

This file demonstrates how to integrate CrewAI with LangWatch using OpenLLMetry instrumentation.

Installation Requirements:
    pip install crewai
    pip install opentelemetry-instrumentation-crewai
    pip install langwatch

For more information, see: https://docs.langwatch.ai/integration/python/integrations/crew-ai
"""

import os
from dotenv import load_dotenv

import langwatch
import chainlit as cl

load_dotenv()

from opentelemetry.instrumentation.crewai import CrewAIInstrumentor

# Setup LangWatch with OpenLLMetry CrewAI instrumentor
langwatch.setup(instrumentors=[CrewAIInstrumentor()])


# Example CrewAI agents and tasks
def create_planning_crew():
    """Create a planning crew for event organization"""
    try:
        from crewai import Agent, Task, Crew

        planner = Agent(
            role="Event Planner",
            goal="Plan an engaging tech conference",
            backstory="An experienced planner with a passion for technology events.",
        )
        task_planner = Task(
            description="Outline the agenda for a 3-day AI conference.",
            agent=planner,
            expected_output="A detailed 3-day conference agenda with session topics, speakers, and timing.",
        )
        conference_crew = Crew(agents=[planner], tasks=[task_planner])
        return conference_crew

    except ImportError as e:
        return None


def create_market_analysis_crew():
    """Create a market analysis crew"""
    try:
        from crewai import Agent, Task, Crew

        researcher = Agent(
            role="Market Analyst",
            goal="Analyze market trends in AI",
            backstory="A skilled analyst with deep understanding of technology markets.",
        )
        task_analyst = Task(
            description="Analyze current AI market trends and provide insights.",
            agent=researcher,
            expected_output="A comprehensive market analysis report with key trends, insights, and recommendations.",
        )
        analysis_crew = Crew(agents=[researcher], tasks=[task_analyst])
        return analysis_crew

    except ImportError as e:
        return None


@cl.on_message
async def main(message: cl.Message):
    """Main chainlit handler for CrewAI examples"""
    msg = cl.Message(content="")

    # Check if CrewAI is available
    try:
        import crewai
    except ImportError:
        await msg.stream_token(
            "❌ CrewAI is not installed. Please install it with: pip install crewai"
        )
        await msg.update()
        return

    # Check if OpenLLMetry instrumentation is available
    try:
        from opentelemetry.instrumentation.crewai import CrewAIInstrumentor
    except ImportError:
        await msg.stream_token(
            "❌ OpenLLMetry CrewAI instrumentation is not installed. Please install it with: pip install opentelemetry-instrumentation-crewai"
        )
        await msg.update()
        return

    await msg.stream_token(
        "🤖 Setting up CrewAI with OpenLLMetry instrumentation...\n\n"
    )

    # Create and run the planning crew
    await msg.stream_token("📅 Creating event planning crew...\n")
    planning_crew = create_planning_crew()

    if planning_crew is None:
        await msg.stream_token(
            "❌ Failed to create planning crew. Please check your CrewAI installation.\n"
        )
        await msg.update()
        return

    await msg.stream_token("📝 Planning crew created successfully!\n")
    await msg.stream_token("🚀 Starting conference planning process...\n\n")

    # Run the crew with LangWatch tracing
    with langwatch.trace(name="CrewAI Planning Process with OpenLLMetry"):
        try:
            result = planning_crew.kickoff()
            await msg.stream_token(
                f"✅ Conference planning completed!\n\n📊 Results:\n{result}\n"
            )
        except Exception as e:
            await msg.stream_token(f"❌ Error during planning: {str(e)}\n")

    await msg.stream_token(
        "\n🎯 This example demonstrates CrewAI integration with OpenLLMetry instrumentation via LangWatch.\n"
    )
    await msg.stream_token(
        "📈 All agent interactions, task executions, and LLM calls are automatically traced and can be viewed in your LangWatch dashboard.\n"
    )

    await msg.update()


@cl.on_chat_start
async def on_chat_start():
    """Initialize the chat session"""
    await cl.Message(
        content="🤖 Welcome to CrewAI with OpenLLMetry! This example demonstrates how CrewAI agents work with LangWatch telemetry.\n\n"
        "💡 Ask any question to see the planning crew in action, or just say 'hello' to get started!\n\n"
        "📅 The crew will plan a tech conference agenda, with all operations automatically traced."
    ).send()
