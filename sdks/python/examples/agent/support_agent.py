"""A support agent connected to LangWatch Agent Testing.

Run it with `python support_agent.py`. The decorator registers the function,
opens the connection and the platform shows the agent Online. The script
blocks in `langwatch.agent.serve()` until Ctrl-C.

Environment:
    LANGWATCH_API_KEY   the API key of your project (required)
    OPENAI_API_KEY      the OpenAI key the agent uses
    APP_ENV             the environment shown next to the agent, default development
"""

from __future__ import annotations

from typing import Literal

from dotenv import load_dotenv
from openai import OpenAI

import langwatch

load_dotenv()

SYSTEM_PROMPT = (
    "You are the support agent of ACME, an online shop. Answer in two short "
    "sentences. The customer is on the {plan} plan."
)


def _openai() -> OpenAI:
    return OpenAI()


@langwatch.connect_agent(
    name="support-agent",
    description="Answers support questions for the ACME shop",
)
@langwatch.trace(name="support_agent")
def support_agent(
    messages: list[langwatch.Message],
    thread_id: str,
    session: dict | None,
    model: Literal["gpt-5-mini", "gpt-5"] = "gpt-5-mini",
    plan: str = "free",
) -> langwatch.AgentReply:
    """One conversation turn.

    `messages` is the full conversation. `thread_id` is the platform's
    conversation id. `session` is whatever this function returned on the
    previous turn of the same thread, `None` on the first turn. `model` and
    `plan` are run parameters the platform can set per run.
    """
    turn = (session or {}).get("turn", 0) + 1
    client = _openai()
    langwatch.get_current_trace().autotrack_openai_calls(client)

    completion = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT.format(plan=plan)},
            *messages,
        ],
    )
    output = completion.choices[0].message.content or ""
    return langwatch.AgentReply(
        output=output,
        session={"thread_id": thread_id, "turn": turn},
    )


if __name__ == "__main__":
    langwatch.agent.serve()
