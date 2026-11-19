"""Model calls the app sends through its engine proxy, nlpgo's /go/proxy/v1 (ADR-203).

A call whose base URL host the organization bound to a private endpoint must
not be dialled from here: litellm would resolve the name through DNS. The app
rewrites such a call to go to nlpgo's proxy instead, with the signed bindings
in its extra headers, and nlpgo verifies them and dials the registered
addresses. langevals never reads the bindings and never chooses an address.

The proxy wants the engine's credential. The app sends it to langevals in a
request header, never in the body (a body can be staged in a customer's own
bucket), together with the proxy's URL. This module adds the credential to a
call's extra headers only when the call goes to exactly that proxy, so it can
never reach a model provider.

A call that carries the credential never follows a redirect either: the OpenAI
SDK follows one by default, and httpx drops only `Authorization` when it leaves
the origin, so the credential header would go wherever a `Location` points.
"""

import json
from typing import Any, Mapping, Optional
from urllib.parse import urlsplit

import httpx
from openai import AsyncOpenAI, OpenAI

ENGINE_PROXY_HEADER = "X-LangWatch-Engine-Proxy"
ENGINE_SECRET_HEADER = "X-LangWatch-NLP-Secret"

# The api key a proxied call sends; nlpgo reads the credential header, not this.
ENGINE_PROXY_API_KEY = "langwatch-engine-proxy"

# The env prefixes an evaluator's model blocks arrive under.
EVALUATOR_ENV_PREFIXES = ("X_LITELLM_", "X_LITELLM_EMBEDDINGS_")


class EngineRoute:
    """The engine proxy the app named for this request, and its credential."""

    def __init__(self, proxy_url: str, secret: str):
        self.proxy_url = proxy_url
        self.secret = secret

    def serves(self, url: Any) -> bool:
        """Whether a call to `url` goes to this proxy: same scheme, host and port, under its path."""
        if not isinstance(url, str) or url == "":
            return False
        try:
            call, proxy = urlsplit(url), urlsplit(self.proxy_url)
            call_port, proxy_port = call.port, proxy.port
        except ValueError:
            return False
        if call.scheme.lower() != proxy.scheme.lower() or call.username or call.password:
            return False
        if (call.hostname or "") != (proxy.hostname or "") or call_port != proxy_port:
            return False
        base = proxy.path.rstrip("/")
        path = call.path.rstrip("/")
        return path == base or path.startswith(base + "/")


def engine_route(headers: Mapping[str, str]) -> Optional[EngineRoute]:
    """The engine route a request's headers name, or None unless both are present."""
    lowered = {key.lower(): value for key, value in headers.items()}
    proxy_url = (lowered.get(ENGINE_PROXY_HEADER.lower()) or "").strip()
    secret = (lowered.get(ENGINE_SECRET_HEADER.lower()) or "").strip()
    if not proxy_url or not secret:
        return None
    return EngineRoute(proxy_url, secret)


def _with_secret(extra_headers: Any, secret: str) -> Optional[str]:
    if extra_headers is None or extra_headers == "":
        headers: Any = {}
    elif isinstance(extra_headers, str):
        try:
            headers = json.loads(extra_headers)
        except ValueError:
            return None
    else:
        headers = dict(extra_headers)
    if not isinstance(headers, dict):
        return None
    return json.dumps({**headers, ENGINE_SECRET_HEADER: secret})


def with_engine_credential(
    params: Optional[dict], route: Optional[EngineRoute], prefix: str = ""
) -> Optional[dict]:
    """The params with the engine's credential added, if they call the engine proxy.

    `prefix` names the key family: "" for litellm parameters, "X_LITELLM_" or
    "X_LITELLM_EMBEDDINGS_" for an evaluator's env. Anything not sent to the
    proxy comes back as it was.
    """
    if params is None or route is None:
        return params
    if not route.serves(params.get(f"{prefix}api_base")):
        return params
    headers = _with_secret(params.get(f"{prefix}extra_headers"), route.secret)
    if headers is None:
        return params
    return {**params, f"{prefix}extra_headers": headers}


def evaluator_env_with_engine_credential(
    env: Optional[dict], route: Optional[EngineRoute]
) -> Optional[dict]:
    """An evaluator's env with the credential added to each model block sent to the proxy."""
    for prefix in EVALUATOR_ENV_PREFIXES:
        env = with_engine_credential(env, route, prefix)
    return env


def _carries_engine_credential(extra_headers: Any) -> bool:
    if isinstance(extra_headers, str):
        try:
            extra_headers = json.loads(extra_headers)
        except ValueError:
            return False
    if not isinstance(extra_headers, Mapping):
        return False
    return any(str(key).lower() == ENGINE_SECRET_HEADER.lower() for key in extra_headers)


_no_redirect_clients: dict = {}


def _no_redirect_http_client(is_async: bool) -> httpx.Client | httpx.AsyncClient:
    """One shared httpx client per kind that never follows a redirect."""
    if is_async not in _no_redirect_clients:
        kind = httpx.AsyncClient if is_async else httpx.Client
        _no_redirect_clients[is_async] = kind(follow_redirects=False)
    return _no_redirect_clients[is_async]


def without_redirects_for_engine_credential(kwargs: dict, is_async: bool) -> dict:
    """The litellm call arguments, with a client that never follows a redirect if they carry the credential.

    litellm's own OpenAI client follows redirects. A call whose extra headers
    hold the engine credential gets an OpenAI client of its own for its
    `api_base` instead, so an upstream 3xx fails the call rather than carrying
    the credential to the `Location`. Any other call comes back as it was.
    """
    api_base = kwargs.get("api_base")
    if not api_base or not _carries_engine_credential(kwargs.get("extra_headers")):
        return kwargs
    client_class = AsyncOpenAI if is_async else OpenAI
    options: dict = {}
    if isinstance(kwargs.get("max_retries"), int):
        options["max_retries"] = kwargs["max_retries"]
    client = client_class(
        api_key=kwargs.get("api_key") or ENGINE_PROXY_API_KEY,
        base_url=api_base,
        http_client=_no_redirect_http_client(is_async),
        **options,
    )
    return {**kwargs, "client": client}
