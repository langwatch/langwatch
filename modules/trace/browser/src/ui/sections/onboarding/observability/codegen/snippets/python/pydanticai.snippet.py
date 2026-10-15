from pydantic_ai import Agent
import langwatch  # +

langwatch.setup()  # +

agent = Agent(
    "openai:gpt-5",
    instructions="Be funny, but not too funny.",
)

if __name__ == "__main__":
    result = agent.run_sync("Tell me a joke")
    print(result.output)
