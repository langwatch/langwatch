"""The checkout graph: an assistant node that talks to the guest, and four step
nodes that do the work.

The assistant answers with OpenAI, or with an Azure deployment when one is
configured, and asks for a step by calling one of four tools. The graph routes each call to its node: `cart_review`, `discount_code`,
`payment` and `confirmation`. The node runs the step against the store,
records the outcome in the state and answers the tool call, and the assistant
turns that into the reply. The state of a conversation lives in the graph's
in-memory checkpointer under its thread id.
"""

from __future__ import annotations

import json
import os
from typing import Annotated, Any, TypedDict

from dotenv import load_dotenv
from langchain_core.messages import AIMessage, AnyMessage, SystemMessage, ToolMessage
from langchain_core.runnables import Runnable, RunnableConfig
from langchain_openai import AzureChatOpenAI, ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from .store import cart_totals, charge, check_discount_code, order_number

load_dotenv()

MODEL = "gpt-5-mini"

# Azure names a model by its deployment, so the deployment is expected to carry
# the name in MODEL and both sides talk about the same model.
DEFAULT_AZURE_API_VERSION = "2024-10-21"

SYSTEM_PROMPT = (
    "You are the checkout assistant of ACME, an online store, helping a guest "
    "finish their order. Use the tools for the work: review_cart to see the cart "
    "and the total, apply_discount_code for a code the guest gives, pay for the "
    "card details the guest gives, and place_order to complete a paid order. "
    "Only state cart contents, totals, discounts, payments and order numbers that "
    "a tool returned. When a code is refused, say why in one sentence. When a "
    "payment is declined, say so and ask for another card. Paying needs the card "
    "number, the expiry and the name on the card; ask for what is missing. "
    "Answer the guest in at most three short sentences."
)

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "review_cart",
            "description": "Read the guest's cart: every line, the discount, shipping and the total.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "apply_discount_code",
            "description": "Apply a discount code to the cart.",
            "parameters": {
                "type": "object",
                "properties": {"code": {"type": "string", "description": "For example WELCOME10"}},
                "required": ["code"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "pay",
            "description": "Charge the cart total to the guest's card.",
            "parameters": {
                "type": "object",
                "properties": {
                    "card_number": {"type": "string"},
                    "expiry": {"type": "string", "description": "MM/YY"},
                    "name": {"type": "string", "description": "The name on the card"},
                },
                "required": ["card_number", "expiry", "name"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "place_order",
            "description": "Place the order once it is paid, and get the order number.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
]

#: Which node runs each tool the assistant can call.
STEP_NODES: dict[str, str] = {
    "review_cart": "cart_review",
    "apply_discount_code": "discount_code",
    "pay": "payment",
    "place_order": "confirmation",
}


class CheckoutState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], add_messages]
    discount_code: str | None
    payment_id: str | None
    order_number: str | None


def _llm() -> Runnable[Any, Any]:
    """The assistant's model: an Azure deployment when one is configured, OpenAI otherwise."""
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    if endpoint and os.getenv("AZURE_OPENAI_API_KEY"):
        model: ChatOpenAI = AzureChatOpenAI(
            azure_endpoint=endpoint,
            azure_deployment=MODEL,
            api_version=os.getenv(
                "AZURE_OPENAI_API_VERSION", DEFAULT_AZURE_API_VERSION
            ),
        )
    else:
        model = ChatOpenAI(model=MODEL)
    return model.bind_tools(TOOLS, parallel_tool_calls=False)


def _pending_call(state: CheckoutState) -> dict:
    last = state["messages"][-1]
    assert isinstance(last, AIMessage) and last.tool_calls
    return last.tool_calls[0]


def _answer(call: dict, payload: dict) -> list[ToolMessage]:
    return [ToolMessage(content=json.dumps(payload), tool_call_id=call["id"])]


def assistant(state: CheckoutState) -> dict:
    response = _llm().invoke([SystemMessage(content=SYSTEM_PROMPT), *state["messages"]])
    return {"messages": [response]}


def route_after_assistant(state: CheckoutState) -> str:
    last = state["messages"][-1]
    if isinstance(last, AIMessage) and last.tool_calls:
        return STEP_NODES.get(last.tool_calls[0]["name"], END)
    return END


def cart_review(state: CheckoutState) -> dict:
    call = _pending_call(state)
    return {"messages": _answer(call, cart_totals(discount_code=state.get("discount_code")))}


def discount_code(state: CheckoutState) -> dict:
    call = _pending_call(state)
    outcome = check_discount_code(code=str(call["args"].get("code", "")))
    applied = outcome["code"] if outcome["ok"] else state.get("discount_code")
    return {
        "discount_code": applied,
        "messages": _answer(
            call, {**outcome, "totals": cart_totals(discount_code=applied)}
        ),
    }


def payment(state: CheckoutState) -> dict:
    call = _pending_call(state)
    if state.get("payment_id"):
        return {
            "messages": _answer(
                call, {"ok": False, "reason": "already_paid", "payment_id": state["payment_id"]}
            )
        }
    totals = cart_totals(discount_code=state.get("discount_code"))
    outcome = charge(
        card_number=str(call["args"].get("card_number", "")), amount=totals["total"]
    )
    return {
        "payment_id": outcome["payment_id"] if outcome["ok"] else None,
        "messages": _answer(call, outcome),
    }


def confirmation(state: CheckoutState, config: RunnableConfig) -> dict:
    call = _pending_call(state)
    if not state.get("payment_id"):
        return {"messages": _answer(call, {"ok": False, "reason": "payment_required"})}
    number = state.get("order_number") or order_number(
        thread_id=str(config["configurable"]["thread_id"])
    )
    return {
        "order_number": number,
        "messages": _answer(
            call,
            {
                "ok": True,
                "order_number": number,
                "payment_id": state["payment_id"],
                "total": cart_totals(discount_code=state.get("discount_code"))["total"],
            },
        ),
    }


def build_graph():
    builder = StateGraph(CheckoutState)
    builder.add_node("assistant", assistant)
    builder.add_node("cart_review", cart_review)
    builder.add_node("discount_code", discount_code)
    builder.add_node("payment", payment)
    builder.add_node("confirmation", confirmation)
    builder.add_edge(START, "assistant")
    builder.add_conditional_edges(
        "assistant", route_after_assistant, [*STEP_NODES.values(), END]
    )
    for node in STEP_NODES.values():
        builder.add_edge(node, "assistant")
    return builder.compile(checkpointer=InMemorySaver())


graph = build_graph()


def _text_of(message: AnyMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    return "".join(
        block.get("text", "") if isinstance(block, dict) else str(block)
        for block in content
    )


def run_turn(*, messages: list[dict], thread_id: str) -> dict:
    """One conversation turn.

    A thread the graph has not seen takes the whole message list, so a client
    can open a conversation mid-way. A known thread takes the last message
    only: the earlier ones are already in its state.
    """
    config: RunnableConfig = {"configurable": {"thread_id": thread_id}}
    known = graph.get_state(config).values.get("messages", [])
    incoming = messages[-1:] if known else messages
    result = graph.invoke({"messages": incoming}, config)
    return {
        "output": _text_of(result["messages"][-1]),
        "order_number": result.get("order_number"),
    }
