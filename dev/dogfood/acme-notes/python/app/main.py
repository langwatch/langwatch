"""The ACME notes application: one HTTP endpoint over a single OpenAI call.

A deliberately small agent with no framework around it, no tracing and no
tests, kept for the guided onboarding scenarios that are about the folder
rather than about the code: a project whose manifest is `requirements.txt`
with no lock file and no virtual environment beside it.

Run it with `python3 -m uvicorn app.main:app --port 8768`.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from openai import AzureOpenAI, OpenAI
from pydantic import BaseModel

load_dotenv()

MODEL = "gpt-5-mini"

DEFAULT_AZURE_API_VERSION = "2024-10-21"

SYSTEM_PROMPT = (
    "You are the notes assistant of ACME, an online store. A colleague gives "
    "you a rough note from a customer call and you answer with a short, tidy "
    "summary of it: what the customer asked for, and what was promised. Two "
    "sentences at most, no bullet points, no preamble."
)

app = FastAPI(title="ACME notes")


class SummarizeRequest(BaseModel):
    note: str


class SummarizeResponse(BaseModel):
    summary: str


def _client() -> OpenAI | AzureOpenAI:
    """Azure when a deployment is configured, plain OpenAI otherwise."""
    endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT")
    if endpoint:
        return AzureOpenAI(
            azure_endpoint=endpoint,
            api_key=os.environ["AZURE_OPENAI_API_KEY"],
            api_version=os.environ.get(
                "AZURE_OPENAI_API_VERSION", DEFAULT_AZURE_API_VERSION
            ),
        )
    return OpenAI()


def summarize(note: str) -> str:
    completion = _client().chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": note},
        ],
    )
    return (completion.choices[0].message.content or "").strip()


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/summarize", response_model=SummarizeResponse)
def summarize_endpoint(request: SummarizeRequest) -> SummarizeResponse:
    return SummarizeResponse(summary=summarize(request.note))
