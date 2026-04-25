"""
Thin Python client for the LangWatch AI Gateway.

Used when langwatch_nlp processes (e.g. topic clustering) need to make an
LLM call without going through LiteLLM. Mirrors the inline-credentials
HMAC path documented in specs/nlp-go/_shared/contract.md §8.1 and
implemented on the gateway side at
services/aigateway/adapters/httpapi/internal_auth.go.

Designed to be a drop-in for the small set of `litellm.completion(...)`
call sites that survive the migration: topic-naming inside the topic-
clustering pipeline. Larger surfaces (Studio workflows, prompt
playground) are handled by the Go nlpgo service instead.

Configuration is via env vars:
  - LW_GATEWAY_BASE_URL         — gateway base URL (e.g. https://gateway.langwatch.ai)
  - LW_GATEWAY_INTERNAL_SECRET  — shared HMAC secret (hex)

If either is unset the helper raises GatewayNotConfiguredError; callers
should handle that and fall back to LiteLLM.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any, Mapping

import httpx

GATEWAY_BASE_URL_ENV = "LW_GATEWAY_BASE_URL"
GATEWAY_SECRET_ENV = "LW_GATEWAY_INTERNAL_SECRET"

HEADER_INTERNAL_AUTH = "X-LangWatch-Internal-Auth"
HEADER_INTERNAL_TIMESTAMP = "X-LangWatch-Internal-Timestamp"
HEADER_INLINE_CREDENTIALS = "X-LangWatch-Inline-Credentials"
HEADER_PROJECT_ID = "X-LangWatch-Project-Id"
HEADER_ORIGIN = "X-LangWatch-Origin"


class GatewayNotConfiguredError(RuntimeError):
    """Raised when the gateway env vars are missing — caller should fall back."""


class GatewayHTTPError(RuntimeError):
    """Non-2xx response from the gateway."""

    def __init__(self, status: int, body: str):
        super().__init__(f"gateway returned status {status}: {body[:200]}")
        self.status = status
        self.body = body


def _build_inline_credentials(provider: str, params: Mapping[str, Any]) -> dict[str, Any]:
    """Translate a litellm_params dict into the gateway's inline-credentials JSON.

    Only the slot for the active `provider` is populated. Mirrors the
    gateway-side `parseInlineCredentials` and the Go translator at
    services/nlpgo/adapters/litellm/translator.go (single source of
    truth for field names is the TS prepareLitellmParams).
    """
    blob: dict[str, Any] = {"provider": provider}
    if provider == "openai":
        blob["openai"] = {k: params[k] for k in ("api_key", "api_base", "organization") if k in params and params[k] is not None}
    elif provider == "anthropic":
        blob["anthropic"] = {k: params[k] for k in ("api_key", "api_base") if k in params and params[k] is not None}
    elif provider == "azure":
        blob["azure"] = {k: params[k] for k in ("api_key", "api_base", "api_version", "use_azure_gateway", "extra_headers") if k in params and params[k] is not None}
    elif provider == "bedrock":
        blob["bedrock"] = {k: params[k] for k in ("aws_access_key_id", "aws_secret_access_key", "aws_session_token", "aws_region_name", "aws_bedrock_runtime_endpoint") if k in params and params[k] is not None}
    elif provider in ("vertex_ai", "vertex"):
        blob["provider"] = "vertex_ai"
        blob["vertex_ai"] = {k: params[k] for k in ("vertex_credentials", "vertex_project", "vertex_location") if k in params and params[k] is not None}
    elif provider == "gemini":
        blob["gemini"] = {k: params[k] for k in ("api_key",) if k in params and params[k] is not None}
    elif provider == "custom":
        blob["custom"] = {k: params[k] for k in ("api_key", "api_base") if k in params and params[k] is not None}
    else:
        raise ValueError(f"unsupported provider: {provider!r}")
    return blob


def _sign(secret: str, method: str, path: str, ts: str, body: bytes, creds_header: str) -> str:
    """Produce the X-LangWatch-Internal-Auth header value.

    Canonical input:
        METHOD\\nPATH\\nTIMESTAMP\\nhex(sha256(BODY))\\nhex(sha256(INLINE_CREDS_HEADER))
    """
    body_hash = hashlib.sha256(body).hexdigest()
    creds_hash = hashlib.sha256(creds_header.encode("utf-8")).hexdigest()
    canonical = f"{method}\n{path}\n{ts}\n{body_hash}\n{creds_hash}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()


def _provider_for_model(model: str) -> str:
    """Parse 'openai/gpt-5-mini' → 'openai'. Returns '' for bare ids."""
    if "/" in model:
        return model.split("/", 1)[0].lower()
    return ""


def chat_completions(
    *,
    model: str,
    messages: list[dict[str, Any]],
    litellm_params: Mapping[str, Any],
    project_id: str,
    origin: str = "topic_clustering",
    tools: list[dict[str, Any]] | None = None,
    tool_choice: Any | None = None,
    temperature: float | None = None,
    timeout: float = 60.0,
) -> dict[str, Any]:
    """POST to {LW_GATEWAY_BASE_URL}/v1/chat/completions and return the parsed JSON response.

    Raises GatewayNotConfiguredError when env is missing — caller falls back.
    Raises GatewayHTTPError on non-2xx.
    """
    base_url = os.environ.get(GATEWAY_BASE_URL_ENV, "").rstrip("/")
    secret = os.environ.get(GATEWAY_SECRET_ENV, "")
    if not base_url or not secret:
        raise GatewayNotConfiguredError(
            f"set {GATEWAY_BASE_URL_ENV} and {GATEWAY_SECRET_ENV} to enable gateway calls"
        )

    provider = _provider_for_model(model)
    if not provider:
        raise ValueError(f"model {model!r} has no provider prefix")

    body_payload: dict[str, Any] = {"model": model, "messages": messages}
    if tools is not None:
        body_payload["tools"] = tools
    if tool_choice is not None:
        body_payload["tool_choice"] = tool_choice
    if temperature is not None:
        body_payload["temperature"] = temperature

    body = json.dumps(body_payload, separators=(",", ":")).encode("utf-8")

    inline = _build_inline_credentials(provider, litellm_params)
    creds_header = base64.b64encode(json.dumps(inline, separators=(",", ":")).encode("utf-8")).decode("ascii")

    ts = str(int(time.time()))
    path = "/v1/chat/completions"
    sig = _sign(secret, "POST", path, ts, body, creds_header)

    headers = {
        "Content-Type": "application/json",
        HEADER_INTERNAL_AUTH: sig,
        HEADER_INTERNAL_TIMESTAMP: ts,
        HEADER_INLINE_CREDENTIALS: creds_header,
        HEADER_PROJECT_ID: project_id,
        HEADER_ORIGIN: origin,
    }

    with httpx.Client(timeout=timeout) as client:
        response = client.post(base_url + path, content=body, headers=headers)
    if response.status_code // 100 != 2:
        raise GatewayHTTPError(response.status_code, response.text)
    return response.json()
