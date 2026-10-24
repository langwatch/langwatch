"""A `requests` stand-in for the WASM code-block sandbox.

It covers the surface code blocks use: the verb helpers, Session and Response.
Every call goes through the engine's host bridge, under the deployment's
egress policy. Streaming, adapters, auth classes and cookies are not provided.
"""

from __future__ import annotations

import _lw_host
from _lw_http import BaseResponse, CaseInsensitiveDict, perform

__version__ = "2.32.0-langwatch-wasm"


class RequestException(IOError):
    def __init__(self, *args, response=None, request=None):
        super().__init__(*args)
        self.response = response
        self.request = request


class HTTPError(RequestException):
    pass


class ConnectionError(RequestException):  # noqa: A001 - mirrors requests
    pass


class Timeout(RequestException):
    pass


class ConnectTimeout(ConnectionError, Timeout):
    pass


class ReadTimeout(Timeout):
    pass


class TooManyRedirects(RequestException):
    pass


class exceptions:  # noqa: N801 - mirrors `requests.exceptions`
    RequestException = RequestException
    HTTPError = HTTPError
    ConnectionError = ConnectionError
    Timeout = Timeout
    ConnectTimeout = ConnectTimeout
    ReadTimeout = ReadTimeout
    TooManyRedirects = TooManyRedirects


class Response(BaseResponse):
    @property
    def reason(self):
        return ""

    def raise_for_status(self):
        if self.status_code >= 400:
            kind = "Client" if self.status_code < 500 else "Server"
            raise HTTPError(f"{self.status_code} {kind} Error for url: {self.url}", response=self)

    def iter_content(self, chunk_size=1, decode_unicode=False):
        data = self.text if decode_unicode else self.content
        step = chunk_size or len(data) or 1
        for i in range(0, len(data), step):
            yield data[i : i + step]


def _translate(exc: _lw_host.HostError):
    if exc.kind == "timeout":
        return Timeout(str(exc))
    if exc.kind == "redirects":
        return TooManyRedirects(str(exc))
    return ConnectionError(str(exc))


def request(method, url, params=None, data=None, headers=None, json=None, timeout=None, **_ignored):
    try:
        status, resp_headers, body, final_url = perform(
            method, url, params=params, headers=headers, data=data, json=json, timeout=timeout
        )
    except _lw_host.HostError as exc:
        raise _translate(exc) from None
    return Response(status, resp_headers, body, final_url, method.upper())


def get(url, params=None, **kwargs):
    return request("GET", url, params=params, **kwargs)


def options(url, **kwargs):
    return request("OPTIONS", url, **kwargs)


def head(url, **kwargs):
    return request("HEAD", url, **kwargs)


def post(url, data=None, json=None, **kwargs):
    return request("POST", url, data=data, json=json, **kwargs)


def put(url, data=None, **kwargs):
    return request("PUT", url, data=data, **kwargs)


def patch(url, data=None, **kwargs):
    return request("PATCH", url, data=data, **kwargs)


def delete(url, **kwargs):
    return request("DELETE", url, **kwargs)


class Session:
    def __init__(self):
        self.headers = CaseInsensitiveDict()
        self.params = {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        pass

    def request(self, method, url, params=None, headers=None, **kwargs):
        merged_headers = CaseInsensitiveDict(self.headers)
        merged_headers.update(headers or {})
        merged_params = dict(self.params)
        merged_params.update(params or {})
        return request(method, url, params=merged_params, headers=merged_headers, **kwargs)

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def post(self, url, data=None, json=None, **kwargs):
        return self.request("POST", url, data=data, json=json, **kwargs)

    def put(self, url, data=None, **kwargs):
        return self.request("PUT", url, data=data, **kwargs)

    def patch(self, url, data=None, **kwargs):
        return self.request("PATCH", url, data=data, **kwargs)

    def delete(self, url, **kwargs):
        return self.request("DELETE", url, **kwargs)

    def head(self, url, **kwargs):
        return self.request("HEAD", url, **kwargs)


def session():
    return Session()
