"""The engine's credential goes only to the engine proxy the app named (ADR-203).

The app sends a model call to a bound host through nlpgo's proxy and names the
proxy and its credential in request headers. These pin that the credential is
added to a call's extra headers only when the call goes to exactly that proxy,
and that langevals never reads or changes the signed bindings it relays.

Scenarios: specs/security/org-private-model-endpoints.feature
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import openai
import pytest
from openai import AsyncOpenAI, OpenAI

from langevals_core.engine_proxy import (
    ENGINE_SECRET_HEADER,
    engine_route,
    evaluator_env_with_engine_credential,
    with_engine_credential,
    without_redirects_for_engine_credential,
)

PROXY = "http://langwatch-nlp-svc/go/proxy/v1"
SIGNED = {
    "X-LangWatch-Private-Endpoints": "payload.signature",
    "X-LangWatch-Project-Id": "acme-prod",
    "x-litellm-api_base": "https://llm.internal.acme.test/v1",
}
ROUTE = engine_route(
    {"x-langwatch-engine-proxy": PROXY, "X-LangWatch-NLP-Secret": "engine-secret"}
)


def proxied(**overrides) -> dict:
    return {
        "model": "openai/openai/judge",
        "api_base": PROXY,
        "api_key": "langwatch-engine-proxy",
        "extra_headers": json.dumps(SIGNED),
        **overrides,
    }


# @scenario "langevals sends the engine credential only to the engine proxy"
def test_a_call_to_the_engine_proxy_gets_the_credential_and_keeps_the_signed_bindings():
    params = with_engine_credential(proxied(), ROUTE)

    headers = json.loads(params["extra_headers"])
    assert headers == {**SIGNED, ENGINE_SECRET_HEADER: "engine-secret"}
    assert params["api_base"] == PROXY
    assert params["model"] == "openai/openai/judge"


@pytest.mark.parametrize(
    "api_base",
    [
        "https://api.openai.com/v1",
        "https://llm.internal.acme.test/v1",
        "http://langwatch-nlp-svc.evil.test/go/proxy/v1",
        "http://langwatch-nlp-svc:8080/go/proxy/v1",
        "https://langwatch-nlp-svc/go/proxy/v1",
        "http://langwatch-nlp-svc/go/proxy/v1beta-elsewhere",
        "http://langwatch-nlp-svc/go/studio/execute_sync",
        "http://user:pass@langwatch-nlp-svc/go/proxy/v1",
        "",
    ],
)
def test_a_call_anywhere_else_never_gets_the_credential(api_base):
    params = proxied(api_base=api_base)

    assert with_engine_credential(params, ROUTE) == params


def test_a_call_with_no_base_url_is_left_alone():
    params = {"model": "openai/gpt-5-mini", "api_key": "sk"}

    assert with_engine_credential(params, ROUTE) == params


def test_a_path_under_the_proxy_counts_as_the_proxy():
    params = with_engine_credential(proxied(api_base=PROXY + "/"), ROUTE)

    assert ENGINE_SECRET_HEADER in json.loads(params["extra_headers"])


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"X-LangWatch-Engine-Proxy": PROXY},
        {"X-LangWatch-NLP-Secret": "engine-secret"},
        {"X-LangWatch-Engine-Proxy": " ", "X-LangWatch-NLP-Secret": "engine-secret"},
    ],
)
def test_a_request_without_both_headers_names_no_route(headers):
    assert engine_route(headers) is None
    assert with_engine_credential(proxied(), engine_route(headers)) == proxied()


def test_extra_headers_given_as_a_dict_are_kept():
    params = with_engine_credential(proxied(extra_headers=dict(SIGNED)), ROUTE)

    assert json.loads(params["extra_headers"])["X-LangWatch-Project-Id"] == "acme-prod"


def test_extra_headers_that_are_not_an_object_are_left_alone():
    params = proxied(extra_headers="not json")

    assert with_engine_credential(params, ROUTE) == params


def test_an_evaluator_env_gets_the_credential_on_each_proxied_block_only():
    env = {
        "X_LITELLM_model": "openai/openai/judge",
        "X_LITELLM_api_base": PROXY,
        "X_LITELLM_extra_headers": json.dumps(SIGNED),
        "X_LITELLM_EMBEDDINGS_model": "openai/text-embedding-3-small",
        "X_LITELLM_EMBEDDINGS_api_base": "https://api.openai.com/v1",
        "OPENAI_API_KEY": "sk-customer",
    }

    out = evaluator_env_with_engine_credential(env, ROUTE)

    assert json.loads(out["X_LITELLM_extra_headers"])[ENGINE_SECRET_HEADER] == "engine-secret"
    assert "X_LITELLM_EMBEDDINGS_extra_headers" not in out
    assert "engine-secret" not in json.dumps(
        {key: value for key, value in out.items() if key != "X_LITELLM_extra_headers"}
    )


def test_an_evaluator_env_is_unchanged_without_a_route():
    env = {"X_LITELLM_api_base": PROXY, "X_LITELLM_extra_headers": json.dumps(SIGNED)}

    assert evaluator_env_with_engine_credential(env, None) == env
    assert evaluator_env_with_engine_credential(None, ROUTE) is None


def test_a_call_with_the_credential_gets_a_client_that_never_follows_a_redirect():
    params = with_engine_credential(proxied(), ROUTE)

    sync = without_redirects_for_engine_credential(params, is_async=False)
    asynchronous = without_redirects_for_engine_credential(params, is_async=True)

    assert isinstance(sync["client"], OpenAI)
    assert isinstance(asynchronous["client"], AsyncOpenAI)
    for kwargs in (sync, asynchronous):
        assert str(kwargs["client"].base_url).rstrip("/") == PROXY
        assert kwargs["client"]._client.follow_redirects is False
        assert {key: value for key, value in kwargs.items() if key != "client"} == params


@pytest.mark.parametrize(
    "params",
    [
        proxied(),
        {"model": "openai/gpt-5-mini", "api_base": "https://api.openai.com/v1"},
        {"model": "openai/gpt-5-mini", "extra_headers": {ENGINE_SECRET_HEADER: "s"}},
    ],
)
def test_a_call_without_the_credential_or_a_base_url_keeps_litellm_s_client(params):
    assert without_redirects_for_engine_credential(params, is_async=False) is params


class _Recorder(BaseHTTPRequestHandler):
    """Answers every POST with what the server was told to, and records its headers."""

    def do_POST(self):
        self.server.seen.append(dict(self.headers))
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        status, headers, body = self.server.answer
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


@pytest.fixture
def serve():
    servers = []

    def start(answer):
        server = ThreadingHTTPServer(("127.0.0.1", 0), _Recorder)
        server.seen, server.answer = [], answer
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
        return server

    yield start
    for server in servers:
        server.shutdown()
        server.server_close()


# @scenario "langevals sends the engine credential only to the engine proxy"
def test_a_redirect_from_the_proxy_never_carries_the_credential_onward(serve):
    elsewhere = serve((200, {"Content-Type": "application/json"}, b"{}"))
    target = f"http://127.0.0.1:{elsewhere.server_port}/v1/chat/completions"
    proxy = serve((307, {"Location": target}, b""))
    proxy_url = f"http://127.0.0.1:{proxy.server_port}/go/proxy/v1"
    route = engine_route({"X-LangWatch-Engine-Proxy": proxy_url, ENGINE_SECRET_HEADER: "s3"})
    params = with_engine_credential(proxied(api_base=proxy_url), route)

    kwargs = without_redirects_for_engine_credential(params, is_async=False)
    with pytest.raises(openai.APIStatusError) as refused:
        kwargs["client"].with_options(max_retries=0).chat.completions.create(
            model="judge",
            messages=[{"role": "user", "content": "hi"}],
            extra_headers=json.loads(kwargs["extra_headers"]),
        )

    assert refused.value.status_code == 307
    assert proxy.seen[0][ENGINE_SECRET_HEADER] == "s3"
    assert elsewhere.seen == []
