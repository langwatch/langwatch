"""The same support agent inside a FastAPI application.

Run it with `uvicorn support_agent_fastapi:app`. Importing the module is
enough: the decorator on `support_agent` starts the connection on a daemon
thread and the web server keeps the process alive. No `serve()` call is
needed. The HTTP route below is the application's own endpoint and shares
the function with the platform.
"""

from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel

from support_agent import support_agent

app = FastAPI()


class ChatRequest(BaseModel):
    thread_id: str
    messages: list[dict]
    plan: str = "free"


class ChatResponse(BaseModel):
    output: str


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    reply = support_agent(
        messages=request.messages,
        thread_id=request.thread_id,
        session=None,
        plan=request.plan,
    )
    return ChatResponse(output=str(reply.output))
