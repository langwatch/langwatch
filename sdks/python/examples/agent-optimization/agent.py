"""The ACME returns and support agent, as a `dspy.ReAct` module.

The signature instructions and the tool descriptions are short on purpose. They
are what the optimizers rewrite. Neither `check_return_eligibility` nor
`create_return` says which `reason` codes the returns system accepts, and the
codes are not the words a customer uses, so an untrained agent sends `damaged`,
gets a rejection back and retries.

Environment:
    OPENAI_API_KEY      the key the agent and the simulation use
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

# `scenario` pulls in joblib, which imports numpy. dspy 3.3.0 imports numpy
# through a lazy shim that breaks when numpy is first imported after dspy, so
# scenario is imported first in every module of this example.
import scenario
import dspy

REASONS = ("defective", "incorrect_item", "not_as_expected", "remorse")
REFUND_METHODS = ("original_payment", "store_credit")
RETURN_WINDOW_DAYS = 30

ORDERS: dict[str, dict[str, Any]] = {
    "1001": {
        "order_id": "1001",
        "item": "ACME CycloneBlend 900 blender",
        "total": "89.90 EUR",
        "status": "delivered",
        "delivered_days_ago": 4,
        "paid_with": "visa ending 4242",
    },
    "1002": {
        "order_id": "1002",
        "item": "ACME QuietFan Tower",
        "total": "129.00 EUR",
        "status": "delivered",
        "delivered_days_ago": 60,
        "paid_with": "ideal",
    },
    "1003": {
        "order_id": "1003",
        "item": "ACME TrailRunner backpack, 30L, blue",
        "total": "74.50 EUR",
        "status": "delivered",
        "delivered_days_ago": 11,
        "paid_with": "mastercard ending 7781",
    },
}


class SupportSignature(dspy.Signature):
    """You are the support agent of ACME, an online shop. Help the customer with orders and returns."""

    history: dspy.History = dspy.InputField()
    question: str = dspy.InputField()
    answer: str = dspy.OutputField()


def _format_order(order: dict[str, Any]) -> str:
    return (
        f"order {order['order_id']}: {order['item']}, {order['total']}, "
        f"status {order['status']}, delivered {order['delivered_days_ago']} days ago, "
        f"paid with {order['paid_with']}"
    )


def lookup_order(order_id: str) -> str:
    """Look up one order by its id."""
    order = ORDERS.get(order_id.strip())
    if order is None:
        known = ", ".join(sorted(ORDERS))
        return (
            f"No order {order_id} in the system. Known order ids are {known}. "
            "Ask the customer to check the number on their confirmation email."
        )
    return _format_order(order)


def check_return_eligibility(order_id: str, reason: str) -> str:
    """Check if an order can be returned."""
    if reason not in REASONS:
        raise ValueError(f"reason must be one of: {', '.join(REASONS)}")

    order = ORDERS.get(order_id.strip())
    if order is None:
        return f"No order {order_id} in the system, so eligibility cannot be checked."

    days = order["delivered_days_ago"]
    if days > RETURN_WINDOW_DAYS:
        return (
            f"order {order_id} is not eligible: it was delivered {days} days ago and the "
            f"return window is {RETURN_WINDOW_DAYS} days"
        )
    return (
        f"order {order_id} is eligible for a return for reason {reason}, "
        f"{RETURN_WINDOW_DAYS - days} days left in the window"
    )


def create_return(order_id: str, reason: str, refund_method: str) -> str:
    """Create a return for an eligible order."""
    if reason not in REASONS:
        raise ValueError(f"reason must be one of: {', '.join(REASONS)}")
    if refund_method not in REFUND_METHODS:
        raise ValueError(f"refund_method must be one of: {', '.join(REFUND_METHODS)}")

    order = ORDERS.get(order_id.strip())
    if order is None:
        return f"No order {order_id} in the system, so no return was created."

    days = order["delivered_days_ago"]
    if days > RETURN_WINDOW_DAYS:
        return (
            f"no return created: order {order_id} was delivered {days} days ago, "
            f"past the {RETURN_WINDOW_DAYS} day window"
        )

    rma = "RMA-" + hashlib.sha1(f"{order_id}:{reason}".encode()).hexdigest()[:6].upper()
    destination = (
        order["paid_with"] if refund_method == "original_payment" else "ACME store credit"
    )
    return (
        f"return {rma} created for order {order_id}, reason {reason}, "
        f"refund of {order['total']} to {destination} once the item arrives at the warehouse"
    )


def escalate(summary: str) -> str:
    """Hand the conversation to a human agent with a short summary of the case."""
    ticket = "ESC-" + hashlib.sha1(summary.encode()).hexdigest()[:6].upper()
    return f"escalated as {ticket}, a human agent replies within one business day"


TOOLS = [lookup_order, check_return_eligibility, create_return, escalate]


def build_agent(lm: dspy.LM | None = None) -> dspy.ReAct:
    """Build the agent. Pass `lm` to pin this instance to a specific model."""
    agent = dspy.ReAct(SupportSignature, tools=TOOLS, max_iters=8)
    if lm is not None:
        agent.set_lm(lm)
    return agent


def _short_error(observation: str) -> str:
    """Collapse ReAct's traceback observation to its last line.

    A tool that raises lands in the trajectory as
    `Execution error in <tool>: <full traceback>`. The whole traceback would go
    into the simulated conversation, so only the exception line is kept. The
    rejection text itself is preserved, which is what the metric reads.
    """
    if not observation.startswith("Execution error in "):
        return observation
    head = observation.split(":", 1)[0]
    last_line = observation.strip().splitlines()[-1].strip()
    return f"{head}: {last_line}"


def _history_from(messages: list[dict[str, Any]]) -> dspy.History:
    """Build a `dspy.History` of question/answer pairs from the conversation.

    Tool calls and tool results are skipped: they are in the transcript so the
    judge can see the process, but the agent's own history field only carries
    what the customer and the agent said.
    """
    pairs: list[dict[str, Any]] = []
    pending_question: str | None = None
    for message in messages:
        role = message.get("role")
        content = message.get("content")
        if not isinstance(content, str) or not content:
            continue
        if role == "user":
            pending_question = content
        elif role == "assistant" and not message.get("tool_calls"):
            pairs.append({"question": pending_question or "", "answer": content})
            pending_question = None
    return dspy.History(messages=pairs)


def _trajectory_to_messages(pred: dspy.Prediction) -> list[dict[str, Any]]:
    """Turn the ReAct trajectory plus the final answer into OpenAI messages.

    The tool calls are part of what the scenario judges: several criteria are
    about how the agent worked, not only about what it replied. Emitting them as
    real `tool_calls` / `tool` messages is the shape the scenario library's own
    examples use, and it is what puts the tool rejections in front of the judge.
    """
    trajectory = getattr(pred, "trajectory", None) or {}
    messages: list[dict[str, Any]] = []

    index = 0
    while f"tool_name_{index}" in trajectory:
        name = trajectory[f"tool_name_{index}"]
        if name == "finish":
            index += 1
            continue

        args = trajectory.get(f"tool_args_{index}") or {}
        observation = str(trajectory.get(f"observation_{index}", ""))
        call_id = f"call_{index}"

        messages.append(
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": call_id,
                        "type": "function",
                        "function": {"name": name, "arguments": json.dumps(args)},
                    }
                ],
            }
        )
        messages.append(
            {
                "role": "tool",
                "tool_call_id": call_id,
                "content": _short_error(observation),
            }
        )
        index += 1

    messages.append({"role": "assistant", "content": pred.answer})
    return messages


class ReActAdapter(scenario.AgentAdapter):
    """Runs the ReAct agent for one turn of a scenario.

    `captured_trace` collects the DSPy trace of every turn of the scenario. The
    agent runs on the scenario's own event loop in its own thread, and
    `dspy.settings.trace` is a contextvar, so the trace GEPA needs does not
    reach the thread that called the program. `ScenarioProgram.forward`
    re-injects it there.
    """

    def __init__(self, program: dspy.ReAct):
        self.program = program
        self.captured_trace: list[Any] = []

    async def call(self, input: scenario.AgentInput) -> scenario.AgentReturnTypes:
        history = _history_from(list(input.messages[:-1]))
        question = input.last_new_user_message_str()

        with dspy.context(trace=[]):
            pred = await self.program.acall(history=history, question=question)
            self.captured_trace.extend(dspy.settings.trace or [])

        return _trajectory_to_messages(pred)
