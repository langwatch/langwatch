"""The ACME returns agent as a connected agent, for Agent Testing run comparisons.

Same four tools and same in-memory orders as `agent.py`, but the loop is a plain
OpenAI tool-calling loop instead of `dspy.ReAct`, and the function is registered
with `@langwatch.connect_agent`, so a test suite on the platform can run against
it as `connected:returns-agent@<environment>`.

Two tool contracts ship in one file, picked by an environment variable, so a
comparison run has a real before and after side:

    RETURNS_AGENT_TOOL_DESCRIPTIONS=weak      neither `check_return_eligibility`
        nor `create_return` says which `reason` codes the returns system takes,
        and the parameter is a free-text string. The model sends `damaged`, the
        tool rejects the call, the agent retries.

    RETURNS_AGENT_TOOL_DESCRIPTIONS=explicit  the descriptions list the accepted
        codes and the schema carries them as an enum. Default.

Run one process per environment to compare the two:

    APP_ENV=production RETURNS_AGENT_TOOL_DESCRIPTIONS=weak \\
        uv run connected_agent.py
    uv run connected_agent.py                  # development, explicit

Environment:
    LANGWATCH_API_KEY   the API key of the project (required)
    LANGWATCH_ENDPOINT  the LangWatch endpoint, for a self-hosted install
    OPENAI_API_KEY      the key the agent uses
    APP_ENV             the environment shown next to the agent, default development
    RETURNS_AGENT_TOOL_DESCRIPTIONS  `weak` or `explicit`, default `explicit`
"""

from __future__ import annotations

import json
import os
from typing import Any, Literal

from dotenv import load_dotenv
from openai import OpenAI

import langwatch

# `agent.py` imports `scenario` before `dspy` on purpose, see the note there.
# Importing it here keeps that order and reuses the same tools and orders.
from agent import (
    REASONS,
    REFUND_METHODS,
    check_return_eligibility,
    create_return,
    escalate,
    lookup_order,
)

load_dotenv()

MAX_TOOL_ITERATIONS = 8

SYSTEM_PROMPT = (
    "You are the support agent of ACME, an online shop. "
    "Help the customer with orders and returns."
)

REASON_CODES = ", ".join(REASONS)
REFUND_METHOD_CODES = ", ".join(REFUND_METHODS)

WEAK_ELIGIBILITY_DESCRIPTION = "Check if an order can be returned."
EXPLICIT_ELIGIBILITY_DESCRIPTION = (
    f"Check if an order can be returned. `reason` is one of: {REASON_CODES}. "
    "Returns the return window and whether the order is still inside it."
)

WEAK_CREATE_RETURN_DESCRIPTION = "Create a return for an eligible order."
EXPLICIT_CREATE_RETURN_DESCRIPTION = (
    f"Create a return for an eligible order. `reason` is one of: {REASON_CODES}. "
    f"`refund_method` is one of: {REFUND_METHOD_CODES}. Returns the RMA number "
    "and where the refund goes."
)


def _tool_schemas() -> list[dict[str, Any]]:
    """The tool list sent to the model, in the contract this process runs."""
    weak = os.environ.get("RETURNS_AGENT_TOOL_DESCRIPTIONS", "explicit") == "weak"
    reason_property: dict[str, Any] = (
        {"type": "string"}
        if weak
        else {"type": "string", "enum": list(REASONS)}
    )
    refund_method_property: dict[str, Any] = (
        {"type": "string"}
        if weak
        else {"type": "string", "enum": list(REFUND_METHODS)}
    )

    return [
        {
            "type": "function",
            "function": {
                "name": "lookup_order",
                "description": "Look up one order by its id.",
                "parameters": {
                    "type": "object",
                    "properties": {"order_id": {"type": "string"}},
                    "required": ["order_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "check_return_eligibility",
                "description": (
                    WEAK_ELIGIBILITY_DESCRIPTION
                    if weak
                    else EXPLICIT_ELIGIBILITY_DESCRIPTION
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "order_id": {"type": "string"},
                        "reason": reason_property,
                    },
                    "required": ["order_id", "reason"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "create_return",
                "description": (
                    WEAK_CREATE_RETURN_DESCRIPTION
                    if weak
                    else EXPLICIT_CREATE_RETURN_DESCRIPTION
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "order_id": {"type": "string"},
                        "reason": reason_property,
                        "refund_method": refund_method_property,
                    },
                    "required": ["order_id", "reason", "refund_method"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "escalate",
                "description": (
                    "Hand the conversation to a human agent with a short summary "
                    "of the case."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {"summary": {"type": "string"}},
                    "required": ["summary"],
                },
            },
        },
    ]


TOOLS = {
    "lookup_order": lookup_order,
    "check_return_eligibility": check_return_eligibility,
    "create_return": create_return,
    "escalate": escalate,
}


def _run_tool(name: str, arguments: str) -> str:
    """Run one tool call and answer with what the model sees next.

    A rejected argument comes back as the exception text rather than as a
    crash, which is what lets the model correct the call on the next turn.
    """
    function = TOOLS.get(name)
    if function is None:
        return f"no tool named {name}"
    try:
        return function(**json.loads(arguments or "{}"))
    except Exception as error:  # noqa: BLE001 - the model reads this text
        return f"{type(error).__name__}: {error}"


@langwatch.connect_agent(name="returns-agent")
@langwatch.trace(name="returns_agent")
def returns_agent(
    messages: list[langwatch.Message],
    model: Literal["gpt-5", "gpt-5-mini"] = "gpt-5",
    plan: str = "",
) -> str:
    """One conversation turn of the returns agent.

    `messages` is the full conversation. `model` and `plan` are run parameters
    the platform sets per run: `plan` is appended to the system prompt, so an
    optimizer or a run can try a different set of instructions without a code
    change.
    """
    client = OpenAI()
    langwatch.get_current_trace().autotrack_openai_calls(client)

    system = SYSTEM_PROMPT if not plan.strip() else f"{SYSTEM_PROMPT}\n\n{plan.strip()}"
    conversation: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        *messages,
    ]

    for _ in range(MAX_TOOL_ITERATIONS):
        completion = client.chat.completions.create(
            model=model,
            messages=conversation,
            tools=_tool_schemas(),
        )
        reply = completion.choices[0].message
        if not reply.tool_calls:
            return reply.content or ""

        conversation.append(reply.model_dump(exclude_none=True))
        for call in reply.tool_calls:
            conversation.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": _run_tool(call.function.name, call.function.arguments),
                }
            )

    return (
        "I could not finish this on my own. Let me hand you to a human agent "
        "who can take it from here."
    )


if __name__ == "__main__":
    langwatch.agent.serve()
