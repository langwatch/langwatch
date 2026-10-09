"""The ACME checkout application: one HTTP endpoint over the checkout graph.

Run it with `uv run uvicorn app.main:app --reload --port 8767`.
"""

from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel

from .graph import run_turn

app = FastAPI(title="ACME checkout")


class ChatRequest(BaseModel):
    messages: list[dict]
    thread_id: str = "local"


class ChatResponse(BaseModel):
    output: str
    thread_id: str
    order_number: str | None = None


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    turn = run_turn(messages=request.messages, thread_id=request.thread_id)
    return ChatResponse(
        output=turn["output"],
        thread_id=request.thread_id,
        order_number=turn["order_number"],
    )
