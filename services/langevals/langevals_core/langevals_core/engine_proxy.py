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
"""

import json
from typing import Any, Mapping, Optional
from urllib.parse import urlsplit

ENGINE_PROXY_HEADER = "X-LangWatch-Engine-Proxy"
ENGINE_SECRET_HEADER = "X-LangWatch-NLP-Secret"

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
