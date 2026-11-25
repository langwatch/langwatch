"""The ACME shop support agent: one LLM turn with two tools.

`answer_turn` is the shop logic. `acme_support` is the same logic connected
to LangWatch Agent Testing, so a simulation on the platform and a scenario
test in `tests/` run the same code.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from dotenv import load_dotenv
from openai import OpenAI

import langwatch

from .accounts import REFUND_LIMIT_FREE, lookup_order, refund_order

load_dotenv()

#: The account the support agent works on. Every conversation uses this one.
ACCOUNT_ID = "acme-pro"

MAX_TOOL_ROUNDS = 4

SYSTEM_PROMPT = (
    "You are the support agent of ACME, an online shop. "
    "You are talking to the customer of account {account_id}. "
    "Call lookup_order before you state anything about an order. "
    "Call refund_order to refund; never promise a refund you did not get from the tool. "
    f"A refund above {REFUND_LIMIT_FREE:.0f} dollars needs the pro plan. When the tool "
    "refuses for that reason, say in one sentence that the plan does not allow it and "
    "offer to escalate the request to a human support agent. "
    "Answer in at most three short sentences."
)

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "lookup_order",
            "description": "Read one order of the current account.",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string", "description": "For example A-1001"}
                },
                "required": ["order_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "refund_order",
            "description": "Refund an amount on one order of the current account.",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string"},
                    "amount": {"type": "number", "description": "In dollars"},
                },
                "required": ["order_id", "amount"],
                "additionalProperties": False,
            },
        },
    },
]


def _openai() -> OpenAI:
    return OpenAI()


def _run_tool(*, name: str, arguments: str, account_id: str) -> dict:
    args = json.loads(arguments or "{}")
    if name == "lookup_order":
        return lookup_order(account_id=account_id, order_id=str(args.get("order_id", "")))
    if name == "refund_order":
        return refund_order(
            account_id=account_id,
            order_id=str(args.get("order_id", "")),
            amount=float(args.get("amount", 0)),
        )
    return {"error": f"unknown tool {name}"}


def answer_turn(
    *,
    messages: list[dict],
    account_id: str,
    model: str = "gpt-5-mini",
) -> str:
    """One support turn: the model answers, and calls the two tools as it needs them."""
    client = _openai()
    conversation: list[Any] = [
        {"role": "system", "content": SYSTEM_PROMPT.format(account_id=account_id)},
        *messages,
    ]

    for _ in range(MAX_TOOL_ROUNDS):
        completion = client.chat.completions.create(
            model=model,
            messages=conversation,
            tools=TOOLS,
        )
        choice = completion.choices[0].message
        if not choice.tool_calls:
            return choice.content or ""
        conversation.append(choice)
        for tool_call in choice.tool_calls:
            result = _run_tool(
                name=tool_call.function.name,
                arguments=tool_call.function.arguments,
                account_id=account_id,
            )
            conversation.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result),
                }
            )

    return "I could not finish that request. A human support agent will take it over."


@langwatch.connect_agent(name="acme-support")
def acme_support(
    messages: list[langwatch.Message],
    thread_id: str,
    session: dict | None,
    model: Literal["gpt-5-mini", "gpt-5"] = "gpt-5-mini",
) -> langwatch.AgentReply:
    """One conversation turn for LangWatch Agent Testing.

    `messages` is the full conversation, `thread_id` the conversation id and
    `session` what this function returned on the previous turn. `model` has a
    default, which makes it a run parameter the platform can set per run.
    """
    turn = (session or {}).get("turn", 0) + 1
    output = answer_turn(
        messages=list(messages),
        account_id=ACCOUNT_ID,
        model=model,
    )
    return langwatch.AgentReply(output=output, session={"turn": turn})
