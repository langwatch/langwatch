"""A model call goes only where the deployment's egress policy lets it.

A request can name the endpoint an evaluator's model call is sent to
(OPENAI_BASE_URL, X_LITELLM_api_base, ...). Evaluator calls follow the egress
policy the app, the AI gateway and the NLP service share: BLOCK_LOCAL_HTTP_CALLS
and ALLOWED_PROXY_HOSTS from the server environment, cloud metadata always
refused, and every connection pinned to the address that was checked.

Every call here runs through the real patched litellm and the real HTTP
clients underneath it. A local stand-in answers as the provider, so a call
that is let through visibly reaches it, and one that is refused visibly does
not. Connections to anything but loopback are refused and recorded by the
`connects` fixture, so no test can reach the network.
"""

import contextvars
import json
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import litellm
import pytest

from langevals_core import egress, litellm_patch
from langevals_core.litellm_patch import patch_litellm
from langevals_core.request_env import request_env

PUBLIC_IP = "93.184.216.34"
MODEL = "openai/gpt-4.1"
MESSAGES = [{"role": "user", "content": "Is the answer correct?"}]


def _completion_body(model: str) -> dict:
    return {
        "id": "chatcmpl-1",
        "object": "chat.completion",
        "created": 1,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "yes"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }


class _Provider:
    """An OpenAI-compatible stand-in on loopback that counts what reaches it."""

    def __init__(self, redirect_to: str | None = None):
        self.hits: list[str] = []
        provider = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                provider.hits.append(self.path)
                length = int(self.headers.get("content-length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                if redirect_to is not None:
                    self.send_response(307)
                    self.send_header("location", redirect_to + self.path)
                    self.send_header("content-length", "0")
                    self.end_headers()
                    return
                if self.path.endswith("/embeddings"):
                    payload = {
                        "object": "list",
                        "data": [
                            {"object": "embedding", "index": 0, "embedding": [0.1]}
                        ],
                        "model": body.get("model"),
                        "usage": {"prompt_tokens": 1, "total_tokens": 1},
                    }
                    return self._json(payload)
                if body.get("stream"):
                    chunk = {
                        "id": "chatcmpl-1",
                        "object": "chat.completion.chunk",
                        "created": 1,
                        "model": body.get("model"),
                        "choices": [
                            {
                                "index": 0,
                                "delta": {"role": "assistant", "content": "yes"},
                                "finish_reason": "stop",
                            }
                        ],
                    }
                    data = f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n".encode()
                    self.send_response(200)
                    self.send_header("content-type", "text/event-stream")
                    self.send_header("content-length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self._json(_completion_body(body.get("model")))

            def _json(self, payload: dict):
                data = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def provider():
    stand_in = _Provider()
    yield stand_in
    stand_in.close()


@pytest.fixture
def connects(monkeypatch):
    """Every connection attempted to a non-loopback address, which is refused."""
    attempted: list[tuple] = []
    original = socket.socket.connect

    def connect(sock, address):
        if address[0] in ("127.0.0.1", "::1"):
            return original(sock, address)
        attempted.append(address[:2])
        raise ConnectionRefusedError(111, "refused by the test")

    monkeypatch.setattr(socket.socket, "connect", connect)
    return attempted


@pytest.fixture(autouse=True)
def isolated(monkeypatch, connects):
    """The real patched path, with no ambient endpoint, proxy or policy."""
    for key in list(os.environ):
        if key.startswith("X_LITELLM_") or key.upper().endswith("_PROXY"):
            monkeypatch.delenv(key)
    for key in (
        "OPENAI_BASE_URL",
        "OPENAI_API_KEY",
        "BLOCK_LOCAL_HTTP_CALLS",
        "ALLOWED_PROXY_HOSTS",
        "AZURE_DEPLOYMENT_NAME",
    ):
        monkeypatch.delenv(key, raising=False)
    patch_litellm()


@pytest.fixture
def block_local(monkeypatch):
    monkeypatch.setenv("BLOCK_LOCAL_HTTP_CALLS", "true")


@pytest.fixture
def fake_dns(monkeypatch):
    """Answers chosen names with chosen addresses, one answer per lookup.

    The last answer repeats. Every other name goes to the system resolver.
    """
    from langevals_core import egress

    answers: dict[str, list[list[str]]] = {}
    lookups: list[str] = []
    system = egress._system_getaddrinfo

    def getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        name = host.decode() if isinstance(host, bytes) else host
        if name not in answers:
            return system(host, port, family, type, proto, flags)
        lookups.append(name)
        queue = answers[name]
        ips = queue.pop(0) if len(queue) > 1 else queue[0]
        return [
            (
                socket.AF_INET6 if ":" in ip else socket.AF_INET,
                socket.SOCK_STREAM,
                6,
                "",
                (ip, port or 0),
            )
            for ip in ips
        ]

    monkeypatch.setattr(egress, "_system_getaddrinfo", getaddrinfo)

    def answer(name: str, *sequence: list[str]):
        answers[name] = list(sequence)
        return lookups

    return answer


def refusal_code(exception: BaseException | None) -> str | None:
    """The egress refusal's code anywhere in the exception's chain."""
    seen = set()
    while exception is not None and id(exception) not in seen:
        seen.add(id(exception))
        if type(exception).__name__ == "EgressDestinationRefusedError":
            return exception.code
        exception = exception.__cause__ or exception.__context__
    return None


def request_for(api_base: str, **extra) -> dict:
    return {"OPENAI_BASE_URL": api_base, "OPENAI_API_KEY": "request-key", **extra}


def complete(env: dict, **kwargs):
    with request_env(env):
        return litellm_patch.litellm.completion(
            model=MODEL, messages=MESSAGES, max_retries=0, **kwargs
        )


def refused(env: dict, **kwargs) -> str | None:
    try:
        complete(env, **kwargs)
    except Exception as exception:
        return refusal_code(exception)
    raise AssertionError("the call was not refused")


class TestARequestEndpointOnTheLocalNetwork:
    def test_loopback_is_refused_before_any_request(self, block_local, provider):
        code = refused(request_for(f"http://127.0.0.1:{provider.port}"))

        assert code == "private_address"
        assert provider.hits == []

    def test_a_private_address_is_refused(self, block_local, connects):
        code = refused(request_for("http://10.20.30.40:8080/v1"))

        assert code == "private_address"
        assert connects == []

    def test_a_shared_address_range_is_refused(self, block_local, connects):
        code = refused(request_for("http://100.64.0.7/v1"))

        assert code == "private_address"
        assert connects == []

    def test_a_hostname_resolving_to_loopback_is_refused(
        self, block_local, provider, fake_dns
    ):
        fake_dns("judge.loopback.test", ["127.0.0.1"])

        code = refused(request_for(f"http://judge.loopback.test:{provider.port}"))

        assert code == "private_address"
        assert provider.hits == []

    def test_a_request_env_cannot_lift_the_block(self, block_local, provider):
        env = request_for(
            f"http://127.0.0.1:{provider.port}",
            BLOCK_LOCAL_HTTP_CALLS="false",
            ALLOWED_PROXY_HOSTS="127.0.0.1",
        )

        assert refused(env) == "private_address"
        assert provider.hits == []

    def test_the_refusal_does_not_echo_the_url_credentials(self, block_local):
        with pytest.raises(Exception) as raised:
            complete(request_for("http://user:hunter2@127.0.0.1:9/v1?api-key=s3cr3t"))
        message = str(raised.value)

        assert refusal_code(raised.value) == "private_address"
        assert "hunter2" not in message
        assert "s3cr3t" not in message


class TestTheCloudMetadataEndpoint:
    @pytest.mark.parametrize("block", ["true", "false"])
    @pytest.mark.parametrize(
        "api_base",
        [
            "http://169.254.169.254/latest",
            "http://[::ffff:169.254.169.254]/latest",
            "http://168.63.129.16/machine",
            "http://metadata.google.internal/computeMetadata/v1",
        ],
    )
    def test_is_refused_whatever_the_policy(
        self, monkeypatch, connects, block, api_base
    ):
        monkeypatch.setenv("BLOCK_LOCAL_HTTP_CALLS", block)

        assert refused(request_for(api_base)) == "metadata_endpoint"
        assert connects == []

    def test_is_refused_for_an_allow_listed_name(self, monkeypatch, connects, fake_dns):
        monkeypatch.setenv("ALLOWED_PROXY_HOSTS", "llm.corp.test")
        fake_dns("llm.corp.test", ["169.254.169.254"])

        assert refused(request_for("http://llm.corp.test/v1")) == "metadata_endpoint"
        assert connects == []


class TestADestinationThePolicyAdmits:
    def test_a_public_host_is_let_through(self, block_local, connects, fake_dns):
        fake_dns("api.provider.test", [PUBLIC_IP])

        with pytest.raises(Exception) as raised:
            complete(request_for("http://api.provider.test:8443/v1"))

        assert refusal_code(raised.value) is None
        assert connects == [(PUBLIC_IP, 8443)]

    def test_an_allow_listed_host_reaches_its_private_address(
        self, block_local, monkeypatch, provider
    ):
        monkeypatch.setenv("ALLOWED_PROXY_HOSTS", "LocalHost")

        response = complete(request_for(f"http://localhost:{provider.port}"))

        assert response.choices[0].message.content == "yes"
        assert provider.hits == ["/chat/completions"]

    def test_block_local_off_lets_a_private_address_through(
        self, monkeypatch, provider
    ):
        monkeypatch.setenv("BLOCK_LOCAL_HTTP_CALLS", "false")

        response = complete(request_for(f"http://127.0.0.1:{provider.port}"))

        assert response.choices[0].message.content == "yes"
        assert provider.hits == ["/chat/completions"]

    def test_an_endpoint_the_server_chose_is_not_the_requests(
        self, block_local, monkeypatch, provider
    ):
        monkeypatch.setenv("OPENAI_API_KEY", "server-key")
        monkeypatch.setenv("X_LITELLM_api_base", f"http://127.0.0.1:{provider.port}")

        response = complete({"X_LITELLM_temperature": "0"})

        assert response.choices[0].message.content == "yes"
        assert provider.hits == ["/chat/completions"]

    def test_an_endpoint_the_server_environment_names_is_admitted_by_host(
        self, block_local, monkeypatch, provider
    ):
        monkeypatch.setenv("OPENAI_API_KEY", "server-key")
        monkeypatch.setenv("OPENAI_BASE_URL", f"http://127.0.0.1:{provider.port}")

        response = complete({"X_LITELLM_temperature": "0"})

        assert response.choices[0].message.content == "yes"
        assert provider.hits == ["/chat/completions"]

    def test_a_request_naming_the_servers_private_endpoint_is_still_refused(
        self, block_local, monkeypatch, provider
    ):
        monkeypatch.setenv("OPENAI_BASE_URL", f"http://127.0.0.1:{provider.port}")

        code = refused(request_for(f"http://127.0.0.1:{provider.port}/other"))

        assert code == "private_address"
        assert provider.hits == []


class TestTheConnectionItself:
    def test_a_name_that_rebinds_after_the_check_is_dialled_at_the_checked_address(
        self, block_local, connects, provider, fake_dns
    ):
        lookups = fake_dns(
            "rebind.provider.test", [PUBLIC_IP], [PUBLIC_IP], ["127.0.0.1"]
        )

        with pytest.raises(Exception):
            complete(request_for(f"http://rebind.provider.test:{provider.port}"))

        assert provider.hits == []
        assert connects == [(PUBLIC_IP, provider.port)]
        assert lookups, "the name was never resolved by the fence"

    def test_a_concurrent_connection_dials_only_addresses_its_own_fence_checked(
        self, block_local, fake_dns
    ):
        """One call's server-admitted private answer never reaches another call."""
        fake_dns("shared.provider.test", ["10.20.30.40"], [PUBLIC_IP])
        policy = egress.server_egress_policy()
        admitting = egress.Fence(policy, frozenset({"shared.provider.test"}))
        url = httpx.URL("http://shared.provider.test/v1")

        with (
            admitting.active(),
            egress._guarded(url),
            egress.Fence(policy).active(),
            pytest.raises(egress.EgressDestinationRefusedError) as raised,
            egress._guarded(url),
        ):
            pass

        assert raised.value.code == "private_address"

    def test_a_redirect_onto_the_local_network_is_refused(
        self, block_local, monkeypatch
    ):
        target = _Provider()
        hop = _Provider(redirect_to=f"http://127.0.0.1:{target.port}")
        monkeypatch.setenv("ALLOWED_PROXY_HOSTS", "localhost")
        try:
            code = refused(request_for(f"http://localhost:{hop.port}"))
        finally:
            hop.close()
            target.close()

        assert hop.hits == ["/chat/completions"]
        assert target.hits == []
        assert code == "private_address"

    @pytest.mark.anyio
    async def test_an_awaited_redirect_onto_the_local_network_is_refused(
        self, block_local, monkeypatch
    ):
        target = _Provider()
        hop = _Provider(redirect_to=f"http://127.0.0.1:{target.port}")
        monkeypatch.setenv("ALLOWED_PROXY_HOSTS", "localhost")
        try:
            with request_env(request_for(f"http://localhost:{hop.port}")):
                with pytest.raises(Exception) as raised:
                    await litellm_patch.litellm.acompletion(
                        model=MODEL, messages=MESSAGES, max_retries=0
                    )
        finally:
            hop.close()
            target.close()

        assert hop.hits == ["/chat/completions"]
        assert target.hits == []
        assert refusal_code(raised.value) == "private_address"

    def test_a_stream_opened_on_first_read_is_fenced(
        self, block_local, monkeypatch, provider
    ):
        """Some providers hand back a stream that sends its request on first read."""
        import httpx

        class LazyStream:
            completion_stream = None

            def __init__(self):
                self.make_call = lambda **kwargs: httpx.post(
                    f"http://127.0.0.1:{provider.port}/chat/completions", json={}
                )

        monkeypatch.setitem(
            litellm_patch.originals, "completion", lambda *a, **k: LazyStream()
        )
        stream = complete({"X_LITELLM_temperature": "0"})

        with pytest.raises(Exception) as raised:
            stream.make_call(client=None)

        assert refusal_code(raised.value) == "private_address"
        assert provider.hits == []

    def test_a_streamed_call_is_refused(self, block_local, provider):
        code = refused(request_for(f"http://127.0.0.1:{provider.port}"), stream=True)

        assert code == "private_address"
        assert provider.hits == []

    def test_a_streamed_call_to_an_admitted_host_streams(self, monkeypatch, provider):
        monkeypatch.setenv("BLOCK_LOCAL_HTTP_CALLS", "false")

        stream = complete(request_for(f"http://127.0.0.1:{provider.port}"), stream=True)
        text = "".join(chunk.choices[0].delta.content or "" for chunk in stream)

        assert text == "yes"

    @pytest.mark.anyio
    async def test_an_awaited_call_is_refused(self, block_local, provider):
        with request_env(request_for(f"http://127.0.0.1:{provider.port}")):
            with pytest.raises(Exception) as raised:
                await litellm_patch.litellm.acompletion(
                    model=MODEL, messages=MESSAGES, max_retries=0
                )

        assert refusal_code(raised.value) == "private_address"
        assert provider.hits == []

    @pytest.mark.anyio
    async def test_an_awaited_call_to_an_allow_listed_name_goes_through(
        self, block_local, monkeypatch, provider
    ):
        monkeypatch.setenv("ALLOWED_PROXY_HOSTS", "localhost")

        with request_env(request_for(f"http://localhost:{provider.port}")):
            response = await litellm_patch.litellm.acompletion(
                model=MODEL, messages=MESSAGES, max_retries=0
            )

        assert response.choices[0].message.content == "yes"
        assert provider.hits == ["/chat/completions"]

    def test_an_embeddings_endpoint_is_refused(self, block_local, provider):
        env = {
            "X_LITELLM_EMBEDDINGS_api_base": f"http://127.0.0.1:{provider.port}",
            "X_LITELLM_EMBEDDINGS_api_key": "request-key",
        }
        with request_env(env):
            with pytest.raises(Exception) as raised:
                litellm_patch.litellm.embedding(
                    model="openai/text-embedding-3-small", input=["x"], max_retries=0
                )

        assert refusal_code(raised.value) == "private_address"
        assert provider.hits == []


def test_a_refused_destination_is_not_retried(block_local, provider, monkeypatch):
    """Retrying a refusal sends nothing anywhere, but spends the caller's time."""
    from tenacity import wait_none

    from langevals_core import base_evaluator
    from langevals_core.base_evaluator import (
        BaseEvaluator,
        EvaluationResult,
        EvaluatorEntry,
        LLMEvaluatorSettings,
    )

    attempts: list[int] = []

    class Judge(BaseEvaluator[EvaluatorEntry, LLMEvaluatorSettings, EvaluationResult]):
        name = "Judge"
        category = "quality"
        env_vars = []
        is_guardrail = False

        def evaluate(self, entry):
            attempts.append(1)
            return litellm.completion(model=MODEL, messages=MESSAGES, max_retries=0)

    monkeypatch.setattr(
        base_evaluator, "wait_random_exponential", lambda **kwargs: wait_none()
    )

    def evaluate_once():
        # Constructing an evaluator binds its env to the context; keep that here.
        judge = Judge(
            settings=LLMEvaluatorSettings(model=MODEL),
            env=request_for(f"http://127.0.0.1:{provider.port}"),
        )
        return judge._evaluate_entry(EvaluatorEntry(), retries=3)

    result = contextvars.copy_context().run(evaluate_once)

    assert result.error_type == "EgressDestinationRefusedError"
    assert attempts == [1]
    assert provider.hits == []
