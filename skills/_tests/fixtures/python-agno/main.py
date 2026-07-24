from dotenv import load_dotenv

load_dotenv()

from agno.agent import Agent
from agno.models.openai import OpenAIChat

agent = Agent(
    model=OpenAIChat(id="gpt-4o"),
    instructions="You are a helpful assistant that answers questions concisely.",
    markdown=True,
)

agent.print_response("What is the capital of France?", stream=True)
