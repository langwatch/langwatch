"""The ACME support application: one HTTP endpoint over the support agent.

Run it with `uv run uvicorn app.main:app --reload --port 8765`. Importing this
module also runs the `@langwatch.connect_agent` decorator in `app.agent`, so
the same process serves `/chat` and answers simulations from LangWatch.
"""

from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel

from .agent import ACCOUNT_ID, acme_support

app = FastAPI(title="ACME support")


class ChatRequest(BaseModel):
    messages: list[dict]
    thread_id: str = "local"


class ChatResponse(BaseModel):
    output: str
    account_id: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "account_id": ACCOUNT_ID}


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    reply = acme_support(
        messages=request.messages,
        thread_id=request.thread_id,
        session=None,
    )
    return ChatResponse(output=str(reply.output), account_id=ACCOUNT_ID)
