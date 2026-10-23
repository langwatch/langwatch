"""Thin backend adapters. Keys come from the environment only; every call has a timeout.

Request shapes per backend are listed in README.md. No client here retries: a failure is raised as a BackendError
with the platform's skip reason (ADR-182 decision 9), and the router decides what to do with it.
"""
from __future__ import annotations

import json
import math
import os
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, Optional, Protocol

# ---------- request and answer ----------


@dataclass(frozen=True)
class JudgeCall:
    job: str  # search | llm_judge | scenario_judge
    text: str  # the hydrated trace or conversation
    question: str  # search question, evaluator prompt, or scenario criterion
    scenario: Optional[str] = None  # scenario description (scenario_judge)


@dataclass(frozen=True)
class Answer:
    verdict: Optional[bool]
    probability: Optional[float]  # P(yes); None for LLM legs (they give a verdict only)
    cost_usd: float
    latency_ms: float
    input_tokens: int = 0
    output_tokens: int = 0


# Skip reasons of the instant-eval-judge contract (INSTANT_EVAL_SKIP_REASONS).
UNAVAILABLE = "classifier_provider_unavailable"
RATE_LIMITED = "classifier_rate_limited"
TOO_LARGE = "classifier_input_too_large"
FAILED = "classifier_failed"
KEY_INVALID = "classifier_key_invalid"


class BackendError(Exception):
    reason = FAILED

    def __init__(self, message: str = "", reason: Optional[str] = None):
        super().__init__(message)
        if reason:
            self.reason = reason


class BackendUnavailable(BackendError):
    reason = UNAVAILABLE


class BackendTimeout(BackendUnavailable):
    pass


class BackendCapacity(BackendError):
    """Rate limited or out of capacity (429, a GPU queue full)."""
    reason = RATE_LIMITED


def error_for_status(status: int) -> BackendError:
    """HTTP status to the platform's skip reason; the provider's own error text is never kept (ADR-182)."""
    if status in (401, 402, 403):
        return BackendError(f"HTTP {status}", KEY_INVALID)
    if status == 429:
        return BackendCapacity(f"HTTP {status}")
    if status == 413:
        return BackendError(f"HTTP {status}", TOO_LARGE)
    if status >= 500:
        return BackendUnavailable(f"HTTP {status}")
    return BackendError(f"HTTP {status}", FAILED)


class Client(Protocol):
    name: str

    def judge(self, call: JudgeCall, timeout_s: float) -> Answer: ...


# ---------- transport (injectable, so tests never touch the network) ----------

Transport = Callable[[str, dict, dict, float], tuple[int, dict]]


def urllib_transport(url: str, headers: dict, body: dict, timeout_s: float) -> tuple[int, dict]:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", **headers}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {}
    except (TimeoutError, socket.timeout) as e:
        raise BackendTimeout(type(e).__name__) from None
    except (urllib.error.URLError, ConnectionError, OSError) as e:
        if isinstance(getattr(e, "reason", None), (TimeoutError, socket.timeout)):
            raise BackendTimeout("timeout") from None
        raise BackendUnavailable(type(e).__name__) from None


def _key(env_name: str) -> str:
    v = os.environ.get(env_name)
    if not v:
        raise BackendError(f"{env_name} not set", KEY_INVALID)
    return v


# ---------- prices ($ per million tokens, public list prices) ----------

def price(model: str, input_tokens: int, output_tokens: int) -> float:
    table = {
        "decisions": ((0.10, 0.0), 272_000, (0.20, 0.0)),
        "haiku": ((0.10, 0.50), 100_000, (0.50, 2.50)),
        "luna": ((0.10, 0.50), None, None),
        "jev": ((0.042, 0.0), None, None),  # LangWatch's cost; the customer price adds the markup (instant-eval-pricing.ts)
    }
    base, above, long_rate = table[model]
    i, o = long_rate if above is not None and input_tokens > above else base
    return input_tokens / 1e6 * i + output_tokens / 1e6 * o


# ---------- text fitting ----------

ELISION = "\n\n[... {n} bytes omitted from the middle to fit the length limit ...]\n\n"


def cut_keeping_ends(text: str, max_bytes: int) -> tuple[str, bool]:
    """Keep the opening and the ending. The platform's prepareInstantEvalText / fit_judge_content should replace this."""
    b = text.encode("utf-8")
    if len(b) <= max_bytes:
        return text, False
    half = max(0, (max_bytes - 80) // 2)
    head = b[:half].decode("utf-8", "ignore")
    tail = b[len(b) - half:].decode("utf-8", "ignore")
    return head + ELISION.format(n=len(b) - 2 * half) + tail, True


# Jev / Decisions production budget: 32k state tokens minus the question and a 768-token reserve, at 2 bytes per token
# (instant-eval-judge fitBytesPerInputToken).
DECISIONS_STATE_TOKENS = 32_000
DECISIONS_RESERVE_TOKENS = 768
DECISIONS_FIT_BYTES_PER_TOKEN = 2.0
# langevals keeps 128k tokens of content (fit_judge_content); at ~3 bytes per token.
LLM_MAX_CONTENT_BYTES = 128_000 * 3

# ---------- prompts ----------

CRITERION_INSTRUCTIONS = (
    "Judge the AI agent under test (the assistant) in this simulated conversation against one success criterion, "
    "independently of any other goal. Criterion: {criterion}"
)
CRITERION_TRUE = "The conversation shows the criterion was met."
CRITERION_FALSE = "The conversation does not show the criterion was met: it was violated, or the evidence for it is missing."

STRICT_SEARCH_PROMPT = "You are an LLM evaluator answering a yes/no question about a trace or conversation"
STRICT_RESULT_FRAMING = (
    "Answer by calling the `evaluation` function, setting `result` to exactly the true or false value the instructions above "
    "ask you to return. If they say when to return false, return false in that case and true in every other case. If they say "
    "when to return true, return true in that case and false in every other case. `result` is not a rating of the output, never invert it."
)
EVALUATION_TOOL = {
    "name": "evaluation",
    "description": "Record the true or false value the instructions ask for, with a short justification that cites the evidence in the content.",
    "parameters": {
        "type": "object",
        "properties": {
            "reasoning": {"type": "string", "description": "A short justification, written before the result: the condition the instructions give, the evidence in the content that settles it (quote the values or name the tool result), and the value that follows."},
            "result": {"type": "boolean", "description": "Exactly the value the instructions ask you to return. If they say when to return false: false in that case, true otherwise. If they say when to return true: true in that case, false otherwise. Not a judgment of whether the content is good."},
        },
        "required": ["reasoning", "result"],
    },
}


def scenario_text(call: JudgeCall) -> str:
    return f"# Scenario\n{call.scenario or ''}\n\n# Conversation\n{call.text}"


def decision_question(call: JudgeCall) -> tuple[str, Optional[tuple[str, str]], str]:
    """(instructions, (true, false) criteria or None, fitted text): the one yes/no question both decision models get.
    Scenario: the harness's criterion question over "# Scenario ... # Conversation ..."; otherwise the question as is."""
    if call.job == "scenario_judge":
        instructions = CRITERION_INSTRUCTIONS.format(criterion=call.question)[:4000]
        criteria: Optional[tuple[str, str]] = (CRITERION_TRUE, CRITERION_FALSE)
        text = scenario_text(call)
    else:
        instructions, criteria, text = call.question, None, call.text
    q_tokens = math.ceil(len(json.dumps({"q": {"instructions": instructions, "criteria": criteria}}).encode()) / 4)
    budget = DECISIONS_STATE_TOKENS - q_tokens - DECISIONS_RESERVE_TOKENS
    text, _ = cut_keeping_ends(text, int(max(0, budget) * DECISIONS_FIT_BYTES_PER_TOKEN))
    return instructions, criteria, text


def decisions_request(call: JudgeCall, model: str) -> dict:
    instructions, criteria, text = decision_question(call)
    if criteria:  # the predicate has no criteria field: appended to the instructions (openai-decisions.ts fromJevQuestion)
        instructions = f"{instructions}\n\nTrue: {criteria[0]}\nFalse: {criteria[1]}"
    return {"model": model, "input": text, "questions": [{"type": "predicate", "name": "q", "instructions": instructions}]}


def jev_request(call: JudgeCall, model: str) -> dict:
    instructions, criteria, text = decision_question(call)
    q: dict = {"type": "noul", "instructions": instructions}
    if criteria:
        q["criteria"] = {"true": criteria[0], "false": criteria[1]}
    return {"state": text, "model": model, "questions": {"q": q}}


def llm_messages(call: JudgeCall) -> tuple[str, str]:
    """(system, user) of the strict langevals llm_boolean request. search: STRICT_SEARCH_PROMPT with the question as
    the task. llm_judge: the evaluator prompt as system and task (the platform's own langevals call is the faithful
    version). scenario_judge: a boolean stand-in only; production should plug in Scenario's JudgeAgent verdict call."""
    if call.job == "search":
        system, task, body = STRICT_SEARCH_PROMPT, f"Answer this question about the text above with true (yes) or false (no): {call.question}", call.text
    elif call.job == "llm_judge":
        system, task, body = call.question, call.question, call.text
    else:
        system, task, body = STRICT_SEARCH_PROMPT, CRITERION_INSTRUCTIONS.format(criterion=call.question) + f"\nReturn true if: {CRITERION_TRUE}\nReturn false if: {CRITERION_FALSE}", scenario_text(call)
    body, _ = cut_keeping_ends(body, LLM_MAX_CONTENT_BYTES)
    return f"{system}\n\n{STRICT_RESULT_FRAMING}", f"# Input\n{body}\n\n# Task\n{task}"


def _bool(v) -> Optional[bool]:
    if isinstance(v, bool):
        return v
    if isinstance(v, str) and v.lower() in ("true", "false"):
        return v.lower() == "true"
    return None


# ---------- clients ----------


class DecisionsClient:
    name = "decisions"
    url = "https://api.openai.com/v1/decisions"

    def __init__(self, model: str = "gpt-6-luna", key_env: str = "OPENAI_API_KEY", transport: Transport = urllib_transport):
        self.model, self.key_env, self.transport = model, key_env, transport

    def judge(self, call: JudgeCall, timeout_s: float) -> Answer:
        body = decisions_request(call, self.model)
        t0 = time.monotonic()
        status, out = self.transport(self.url, {"authorization": f"Bearer {_key(self.key_env)}"}, body, timeout_s)
        ms = (time.monotonic() - t0) * 1000
        if status != 200:
            raise error_for_status(status)
        answers = out.get("answers") or []
        ans = next((a for a in answers if a.get("name") == "q"), answers[0] if answers else None)
        if not ans or ans.get("type") == "refusal" or not isinstance(ans.get("probability"), (int, float)):
            raise BackendUnavailable("unreadable answer")
        p = float(ans["probability"])
        tin = int((out.get("usage") or {}).get("input_tokens", 0))
        return Answer(verdict=p >= 0.5, probability=p, cost_usd=price("decisions", tin, 0), latency_ms=ms, input_tokens=tin)


class JevClient:
    """TypeSafe Jev as the platform calls it today, on LangWatch's key (model jev-latest). In the platform, wrap its
    HttpInstantEvalClassifierChannel (limiter, retries, too-large cut) instead of this adapter."""
    name = "jev"

    def __init__(self, model: str = "jev-latest", key_env: str = "TYPESAFE_API_KEY", base_url: str = "https://api.typesafe.ai",
                 transport: Transport = urllib_transport):
        self.model, self.key_env, self.url, self.transport = model, key_env, base_url.rstrip("/") + "/v1/systemone", transport

    def judge(self, call: JudgeCall, timeout_s: float) -> Answer:
        body = jev_request(call, self.model)
        t0 = time.monotonic()
        status, out = self.transport(self.url, {"authorization": f"Bearer {_key(self.key_env)}"}, body, timeout_s)
        ms = (time.monotonic() - t0) * 1000
        if status != 200:
            raise error_for_status(status)
        p = ((out.get("answers") or {}).get("q") or {}).get("noul")
        if not isinstance(p, (int, float)):
            raise BackendUnavailable("unreadable answer")
        tin = int((out.get("usage") or {}).get("input_tokens", 0))
        return Answer(verdict=float(p) >= 0.5, probability=float(p), cost_usd=price("jev", tin, 0), latency_ms=ms, input_tokens=tin)


class AnthropicClient:
    name = "haiku"
    url = "https://api.anthropic.com/v1/messages"

    def __init__(self, model: str = "claude-haiku-5-5", key_env: str = "ANTHROPIC_API_KEY", transport: Transport = urllib_transport, price_key: str = "haiku"):
        self.model, self.key_env, self.transport, self.price_key = model, key_env, transport, price_key

    def judge(self, call: JudgeCall, timeout_s: float) -> Answer:
        system, user = llm_messages(call)
        tool = EVALUATION_TOOL
        body = {"model": self.model, "max_tokens": 8000, "system": system, "messages": [{"role": "user", "content": user}],
                "tools": [{"name": tool["name"], "description": tool["description"], "input_schema": tool["parameters"]}],
                "tool_choice": {"type": "tool", "name": "evaluation"}}
        t0 = time.monotonic()
        status, out = self.transport(self.url, {"x-api-key": _key(self.key_env), "anthropic-version": "2023-06-01"}, body, timeout_s)
        ms = (time.monotonic() - t0) * 1000
        if status != 200:
            raise error_for_status(status)
        use = next((c for c in out.get("content", []) if c.get("type") == "tool_use" and c.get("name") == "evaluation"), None)
        verdict = _bool((use or {}).get("input", {}).get("result"))
        u = out.get("usage") or {}
        tin, tout = int(u.get("input_tokens", 0)), int(u.get("output_tokens", 0))
        if verdict is None:
            raise BackendError("no evaluation call", FAILED)
        return Answer(verdict=verdict, probability=None, cost_usd=price(self.price_key, tin, tout), latency_ms=ms, input_tokens=tin, output_tokens=tout)


class OpenAIResponsesClient:
    name = "luna"
    url = "https://api.openai.com/v1/responses"

    def __init__(self, model: str = "gpt-6-luna", key_env: str = "OPENAI_API_KEY", transport: Transport = urllib_transport, price_key: str = "luna"):
        self.model, self.key_env, self.transport, self.price_key = model, key_env, transport, price_key

    def judge(self, call: JudgeCall, timeout_s: float) -> Answer:
        system, user = llm_messages(call)
        tool = EVALUATION_TOOL
        body = {"model": self.model, "input": [{"role": "developer", "content": system}, {"role": "user", "content": user}],
                "max_output_tokens": 8000, "store": False,
                "tools": [{"type": "function", "name": tool["name"], "description": tool["description"], "parameters": tool["parameters"], "strict": False}],
                "tool_choice": {"type": "function", "name": "evaluation"}}
        t0 = time.monotonic()
        status, out = self.transport(self.url, {"authorization": f"Bearer {_key(self.key_env)}"}, body, timeout_s)
        ms = (time.monotonic() - t0) * 1000
        if status != 200:
            raise error_for_status(status)
        fc = next((i for i in out.get("output", []) if i.get("type") == "function_call" and i.get("name") == "evaluation"), None)
        try:
            args = json.loads(fc["arguments"]) if fc else {}
        except (TypeError, ValueError):
            args = {}
        verdict = _bool(args.get("result"))
        u = out.get("usage") or {}
        tin, tout = int(u.get("input_tokens", 0)), int(u.get("output_tokens", 0))
        if verdict is None:
            raise BackendError("no evaluation call", FAILED)
        return Answer(verdict=verdict, probability=None, cost_usd=price(self.price_key, tin, tout), latency_ms=ms, input_tokens=tin, output_tokens=tout)


class VllmClient:
    """OpenAI-compatible server (vLLM) for Vega or Nox. Off by default. The prompt must be the one the model was trained
    on; pass it as `prompt_of`. p = P("true") from the first token's logprobs. Cost is the GPU's, not per call (0 here)."""

    def __init__(self, name: str, model: str, base_url_env: str, key_env: Optional[str] = None,
                 prompt_of: Optional[Callable[[JudgeCall], str]] = None, transport: Transport = urllib_transport):
        self.name, self.model, self.base_url_env, self.key_env, self.transport = name, model, base_url_env, key_env, transport
        self.prompt_of = prompt_of

    def judge(self, call: JudgeCall, timeout_s: float) -> Answer:
        if self.prompt_of is None:
            raise BackendUnavailable(f"{self.name}: no prompt configured")
        base = os.environ.get(self.base_url_env)
        if not base:
            raise BackendUnavailable(f"{self.base_url_env} not set")
        headers = {"authorization": f"Bearer {_key(self.key_env)}"} if self.key_env else {}
        body = {"model": self.model, "prompt": self.prompt_of(call), "max_tokens": 1, "temperature": 0, "logprobs": 20}
        t0 = time.monotonic()
        status, out = self.transport(base.rstrip("/") + "/v1/completions", headers, body, timeout_s)
        ms = (time.monotonic() - t0) * 1000
        if status != 200:
            raise error_for_status(status)
        try:
            top = out["choices"][0]["logprobs"]["top_logprobs"][0]
        except (KeyError, IndexError, TypeError):
            raise BackendUnavailable("no logprobs") from None
        yes = sum(math.exp(v) for k, v in top.items() if k.strip().lower() in ("true", "yes"))
        no = sum(math.exp(v) for k, v in top.items() if k.strip().lower() in ("false", "no"))
        if yes + no == 0:
            raise BackendUnavailable("no yes/no token")
        p = yes / (yes + no)
        return Answer(verdict=p >= 0.5, probability=p, cost_usd=0.0, latency_ms=ms)


def default_clients(table=None, transport: Transport = urllib_transport) -> dict[str, Client]:
    """The v1 clients by backend name. GPU clients are only built for backends the table enables."""
    clients: dict[str, Client] = {
        "decisions": DecisionsClient(transport=transport),
        "jev": JevClient(transport=transport),
        "haiku": AnthropicClient(transport=transport),
        "luna": OpenAIResponsesClient(transport=transport),
    }
    if table is not None:
        for name, model, env in (("vega", "vega-run2", "VEGA_BASE_URL"), ("nox", "nox-4b-lora-run1", "NOX_BASE_URL")):
            if table.backends.get(name) and table.backends[name].enabled:
                clients[name] = VllmClient(name, model, env, key_env=f"{name.upper()}_API_KEY", transport=transport)
    return clients
