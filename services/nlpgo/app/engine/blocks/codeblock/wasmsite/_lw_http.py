"""Request building and responses shared by the requests and httpx stand-ins."""

from __future__ import annotations

import json as _json
from collections.abc import Mapping, MutableMapping
from urllib.parse import urlencode, urlsplit, urlunsplit

import _lw_host


class CaseInsensitiveDict(MutableMapping):
    def __init__(self, data=None):
        self._store: dict[str, tuple[str, str]] = {}
        if data:
            self.update(data)

    def __setitem__(self, key, value):
        self._store[key.lower()] = (key, value)

    def __getitem__(self, key):
        return self._store[key.lower()][1]

    def __delitem__(self, key):
        del self._store[key.lower()]

    def __iter__(self):
        return (original for original, _ in self._store.values())

    def __len__(self):
        return len(self._store)

    def __repr__(self):
        return repr(dict(self.items()))


def merge_params(url: str, params) -> str:
    if not params:
        return url
    pairs = params.items() if isinstance(params, Mapping) else params
    extra = urlencode([(k, v) for k, v in pairs if v is not None], doseq=True)
    parts = urlsplit(url)
    query = f"{parts.query}&{extra}" if parts.query else extra
    return urlunsplit(parts._replace(query=query))


def encode_body(headers: CaseInsensitiveDict, data=None, json=None, content=None):
    if json is not None:
        headers.setdefault("Content-Type", "application/json")
        return _json.dumps(json).encode("utf-8")
    body = content if content is not None else data
    if body is None:
        return None
    if isinstance(body, Mapping):
        headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
        return urlencode(body, doseq=True).encode("utf-8")
    if isinstance(body, str):
        return body.encode("utf-8")
    return bytes(body)


def perform(method, url, *, params=None, headers=None, data=None, json=None, content=None, timeout=None):
    merged = CaseInsensitiveDict(headers or {})
    body = encode_body(merged, data=data, json=json, content=content)
    if isinstance(timeout, tuple):
        timeout = sum(t for t in timeout if t is not None) or None
    reply = _lw_host.fetch(method, merge_params(url, params), dict(merged.items()), body, timeout)
    flat = CaseInsensitiveDict({k: ", ".join(v) for k, v in (reply.get("headers") or {}).items()})
    return reply.get("status", 0), flat, reply["body"], reply.get("url") or url


class BaseResponse:
    def __init__(self, status_code, headers, content, url, method):
        self.status_code = status_code
        self.headers = headers
        self.content = content
        self.url = url
        self.method = method

    @property
    def encoding(self):
        content_type = self.headers.get("content-type", "")
        for part in content_type.split(";")[1:]:
            name, _, value = part.strip().partition("=")
            if name.lower() == "charset" and value:
                return value.strip('"')
        return "utf-8"

    @property
    def text(self):
        return self.content.decode(self.encoding, errors="replace")

    def json(self, **kwargs):
        return _json.loads(self.content, **kwargs)

    @property
    def ok(self):
        return self.status_code < 400

    def __repr__(self):
        return f"<Response [{self.status_code}]>"
