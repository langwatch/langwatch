"""Google ADK with Gemini, instrumented through OpenInference.

    uv run --with langwatch --with google-adk --with "openinference-instrumentation-google-adk>=0.1.11" python google_adk.py image
    uv run --with langwatch --with google-adk --with "openinference-instrumentation-google-adk>=0.1.11" python google_adk.py pdf

An image or a PDF rides a `Part.from_bytes` inline data block next to the
text question, inside one user `Content` message. `GoogleADKInstrumentor`
patches ADK globally, so the run through `Runner.run` is enough to produce a
span. ADK talks to the Gemini Developer API through `GOOGLE_API_KEY`, so the
GEMINI_API_KEY this project already carries is copied into that name before
the agent is built.
"""

import asyncio
import os

from _common import attachment, modality, question, report, require

import langwatch
from google.adk import Agent, Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from openinference.instrumentation.google_adk import GoogleADKInstrumentor

MODEL = "gemini-2.5-flash"
APP_NAME = "multimodal-dogfood"
USER_ID = "dogfood-user"
SESSION_ID = "multimodal-dogfood-session"


@langwatch.trace(name="google adk")
def ask(kind: str) -> str:
    langwatch.get_current_trace().update(
        metadata={"labels": ["multimodal-dogfood", "google-adk", kind]},
    )

    agent = Agent(
        name="multimodal_dogfood_agent",
        model=MODEL,
        instruction="Answer the user's question about the attached file directly.",
    )
    session_service = InMemorySessionService()
    asyncio.run(
        session_service.create_session(
            app_name=APP_NAME, user_id=USER_ID, session_id=SESSION_ID
        )
    )
    runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_service)

    path, media_type = attachment(kind)
    message = types.Content(
        role="user",
        parts=[
            types.Part(text=question(kind)),
            types.Part.from_bytes(data=path.read_bytes(), mime_type=media_type),
        ],
    )

    for event in runner.run(user_id=USER_ID, session_id=SESSION_ID, new_message=message):
        if event.is_final_response():
            return event.content.parts[0].text
    return ""


if __name__ == "__main__":
    require("GEMINI_API_KEY", "LANGWATCH_API_KEY")
    os.environ.setdefault("GOOGLE_API_KEY", os.environ["GEMINI_API_KEY"])
    langwatch.setup(instrumentors=[GoogleADKInstrumentor()])
    which = modality()
    report(f"google-adk/{which}", ask(which))
