from dotenv import load_dotenv

load_dotenv()

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService

agent = Agent(
    name="helper",
    model="gemini-2.0-flash",
    instruction="You are a helpful assistant that answers questions concisely.",
)

session_service = InMemorySessionService()
runner = Runner(agent=agent, app_name="helper-app", session_service=session_service)

session = session_service.create_session(app_name="helper-app", user_id="user1")

response = runner.run(
    user_id="user1",
    session_id=session.id,
    new_message="What is the capital of France?",
)

for event in response:
    if event.is_final_response():
        print(event.content.parts[0].text)
