"""The ACME support agent, connected to LangWatch Agent Testing.

Run it with `python support_agent.py`. The decorator registers the function,
opens the connection and the platform shows the agent Online. The script
blocks in `langwatch.agent.serve()` until Ctrl-C.

Environment:
    LANGWATCH_API_KEY   the API key of the project (required)
    OPENAI_API_KEY      the OpenAI key the agent uses
    AGENT_NAME          the name the agent registers under, default support-agent
    APP_ENV             the environment shown next to the agent, default development
"""

from __future__ import annotations

import json
import os
from typing import Literal

from dotenv import load_dotenv
from openai import OpenAI

import langwatch

load_dotenv()

SYSTEM_PROMPT = (
    "You are the support agent of ACME, an online shop for outdoor gear. Answer "
    "in two short sentences. The customer is on the {plan} plan: free plan "
    "customers pay for express shipping, pro plan customers get free next-day "
    "delivery and priority refunds. When the customer says a colleague handles "
    "the request, look the colleague up with lookup_colleague by email before "
    "promising to hand anything over, and never claim to have contacted "
    "someone the lookup did not find."
)

# The colleagues the agent can hand a request to. A scenario that reproduces
# a handoff has to name one of these emails verbatim: a stand-in misses here,
# and the run then fails for a reason the original conversation never had.
COLLEAGUES: dict[str, dict[str, str]] = {
    "priya.raman@northwind.example": {
        "name": "Priya Raman",
        "role": "workspace admin",
    },
}

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "lookup_colleague",
            "description": (
                "Find a colleague of the customer by email so a request can be "
                "handed to them."
            ),
            "parameters": {
                "type": "object",
                "properties": {"email": {"type": "string"}},
                "required": ["email"],
            },
        },
    }
]


def lookup_colleague(email: str) -> str:
    found = COLLEAGUES.get(email.strip().lower())
    if found is None:
        return json.dumps({"found": False, "email": email})
    return json.dumps({"found": True, "email": email, **found})


# How many model calls one turn may take before the agent answers without a
# further lookup.
MAX_TOOL_ROUNDS = 4


@langwatch.connect_agent(name=os.environ.get("AGENT_NAME", "support-agent"))
@langwatch.trace(name="support_agent")
def support_agent(
    messages: list[langwatch.Message],
    thread_id: str,
    session: dict | None,
    model: Literal["gpt-5-mini", "gpt-5"] = "gpt-5-mini",
    plan: Literal["free", "pro"] = "free",
) -> langwatch.AgentReply:
    """One conversation turn.

    `messages` is the full conversation. `thread_id` is the platform's
    conversation id. `session` is whatever this function returned on the
    previous turn of the same thread, `None` on the first turn. `model` and
    `plan` are run parameters the platform can set per run.
    """
    turn = (session or {}).get("turn", 0) + 1
    client = OpenAI()
    langwatch.get_current_trace().autotrack_openai_calls(client)

    history: list = [
        {"role": "system", "content": SYSTEM_PROMPT.format(plan=plan)},
        *messages,
    ]
    output = ""
    for _ in range(MAX_TOOL_ROUNDS):
        completion = client.chat.completions.create(
            model=model,
            messages=history,
            tools=TOOLS,
        )
        reply = completion.choices[0].message
        if not reply.tool_calls:
            output = reply.content or ""
            break
        history.append(reply)
        for call in reply.tool_calls:
            arguments = json.loads(call.function.arguments or "{}")
            history.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": lookup_colleague(arguments.get("email", "")),
                }
            )
    return langwatch.AgentReply(
        output=output,
        session={"thread_id": thread_id, "turn": turn},
    )


if __name__ == "__main__":
    langwatch.agent.serve()
