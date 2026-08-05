import langwatch  # +
import os

from strands import Agent
from strands.models.litellm import LiteLLMModel

langwatch.setup()  # +


class MyAgent:
    def __init__(self):
        # Configure the model using LiteLLM for provider flexibility
        self.model = LiteLLMModel(
            client_args={"api_key": os.getenv("OPENAI_API_KEY")},
            model_id="openai/gpt-5-mini",
        )

        # Create the agent with tracing attributes
        self.agent = Agent(
            name="my-agent",
            model=self.model,
            system_prompt="You are a helpful AI assistant.",
        )

    def run(self, prompt: str):
        return self.agent(prompt)


agent = MyAgent()

response = agent.run("Tell me a joke")
print(response)
