"""Support chat agent for the ACME Outdoor Gear store.

FastAPI app with a cookie-session login and a /chat endpoint. The "LLM" is a
canned-response function so the app runs with no model provider account.
"""

import os
import uuid

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel

app = FastAPI(title="ACME Outdoor Gear support agent")

# The session cookie is Secure by default. Local HTTP development opts out
# explicitly with INSECURE_DEV_COOKIES=1 (see README).
INSECURE_DEV_COOKIES = os.environ.get("INSECURE_DEV_COOKIES") == "1"

# In-memory session store. /login sets a session cookie; /chat requires it.
SESSIONS: dict[str, str] = {}
DEMO_USERS = {"demo@example.com": "demo-password"}

ORDERS = {
    "A-1001": {"item": "Trail 2 hiking boots", "status": "shipped", "eta": "Tuesday"},
    "A-1002": {"item": "Ridge 40L backpack", "status": "being packed", "eta": "Friday"},
    "A-1003": {"item": "Storm shell jacket", "status": "delivered", "eta": "delivered Monday"},
}


def lookup_order(order_id: str) -> dict | None:
    return ORDERS.get(order_id.upper())


def fake_llm_reply(messages: list[dict]) -> str:
    """Canned-response stand-in for a model call."""
    last = next(
        (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
        "",
    )
    lowered = last.lower()

    for order_id in ORDERS:
        if order_id.lower() in lowered:
            order = lookup_order(order_id)
            assert order is not None
            return (
                f"Your order {order_id} ({order['item']}) is {order['status']}. "
                f"Expected delivery: {order['eta']}."
            )

    if "order" in lowered or "status" in lowered or "delivery" in lowered:
        return "I can check that for you. What is your order number? It looks like A-1001."
    if "return" in lowered or "refund" in lowered:
        return (
            "You can return any item within 30 days of delivery. "
            "Tell me your order number and I will start the return."
        )
    return (
        "Hi! I am the ACME Outdoor Gear assistant. "
        "I can help with order status, deliveries, and returns."
    )


class LoginBody(BaseModel):
    email: str
    password: str


class ChatBody(BaseModel):
    messages: list[dict]


@app.post("/login")
def login(body: LoginBody, response: Response):
    if DEMO_USERS.get(body.email) != body.password:
        raise HTTPException(status_code=401, detail="bad credentials")
    session_id = uuid.uuid4().hex
    SESSIONS[session_id] = body.email
    response.set_cookie(
        "session_id", session_id, httponly=True, secure=not INSECURE_DEV_COOKIES
    )
    return {"ok": True}


def require_session(request: Request) -> str:
    session_id = request.cookies.get("session_id")
    if not session_id or session_id not in SESSIONS:
        raise HTTPException(status_code=401, detail="login required")
    return SESSIONS[session_id]


@app.post("/chat")
def chat(body: ChatBody, request: Request):
    require_session(request)
    reply = fake_llm_reply(body.messages)
    return {"reply": reply}
