"""An `httpx` stand-in for the WASM code-block sandbox.

It covers the verb helpers, Client, AsyncClient and Response. Every call goes
through the engine's host bridge, under the deployment's egress policy. The
async client completes each call before it yields; there is no concurrency.
"""

from __future__ import annotations

import _lw_host
from _lw_http import BaseResponse, CaseInsensitiveDict, perform

__version__ = "0.28.0-langwatch-wasm"


class HTTPError(Exception):
    def __init__(self, message, *, request=None, response=None):
        super().__init__(message)
        self.request = request
        self.response = response


class RequestError(HTTPError):
    pass


class TransportError(RequestError):
    pass


class TimeoutException(TransportError):
    pass


class ConnectError(TransportError):
    pass


class TooManyRedirects(RequestError):
    pass


class HTTPStatusError(HTTPError):
    pass


class Response(BaseResponse):
    @property
    def is_success(self):
        return 200 <= self.status_code < 300

    @property
    def is_error(self):
        return self.status_code >= 400

    def raise_for_status(self):
        if self.status_code >= 400:
            raise HTTPStatusError(
                f"Server error '{self.status_code}' for url '{self.url}'", response=self
            )
        return self

    def read(self):
        return self.content

    async def aread(self):
        return self.content


def _translate(exc: _lw_host.HostError):
    if exc.kind == "timeout":
        return TimeoutException(str(exc))
    if exc.kind == "redirects":
        return TooManyRedirects(str(exc))
    return ConnectError(str(exc))


def request(method, url, *, params=None, headers=None, data=None, json=None, content=None, timeout=None, **_ignored):
    try:
        status, resp_headers, body, final_url = perform(
            method, str(url), params=params, headers=headers, data=data, json=json,
            content=content, timeout=timeout,
        )
    except _lw_host.HostError as exc:
        raise _translate(exc) from None
    return Response(status, resp_headers, body, final_url, method.upper())


def get(url, **kwargs):
    return request("GET", url, **kwargs)


def post(url, **kwargs):
    return request("POST", url, **kwargs)


def put(url, **kwargs):
    return request("PUT", url, **kwargs)


def patch(url, **kwargs):
    return request("PATCH", url, **kwargs)


def delete(url, **kwargs):
    return request("DELETE", url, **kwargs)


def head(url, **kwargs):
    return request("HEAD", url, **kwargs)


class Client:
    def __init__(self, *, base_url="", headers=None, params=None, timeout=None, **_ignored):
        self.base_url = str(base_url).rstrip("/")
        self.headers = CaseInsensitiveDict(headers or {})
        self.params = dict(params or {})
        self.timeout = timeout

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        pass

    def _url(self, url):
        url = str(url)
        if self.base_url and not url.startswith(("http://", "https://")):
            return f"{self.base_url}/{url.lstrip('/')}"
        return url

    def request(self, method, url, *, headers=None, params=None, timeout=None, **kwargs):
        merged_headers = CaseInsensitiveDict(self.headers)
        merged_headers.update(headers or {})
        merged_params = dict(self.params)
        merged_params.update(params or {})
        return request(
            method, self._url(url), headers=merged_headers, params=merged_params,
            timeout=timeout if timeout is not None else self.timeout, **kwargs,
        )

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)

    def put(self, url, **kwargs):
        return self.request("PUT", url, **kwargs)

    def patch(self, url, **kwargs):
        return self.request("PATCH", url, **kwargs)

    def delete(self, url, **kwargs):
        return self.request("DELETE", url, **kwargs)

    def head(self, url, **kwargs):
        return self.request("HEAD", url, **kwargs)


class AsyncClient(Client):
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.aclose()

    async def aclose(self):
        pass

    async def request(self, method, url, **kwargs):
        return Client.request(self, method, url, **kwargs)

    async def get(self, url, **kwargs):
        return await self.request("GET", url, **kwargs)

    async def post(self, url, **kwargs):
        return await self.request("POST", url, **kwargs)

    async def put(self, url, **kwargs):
        return await self.request("PUT", url, **kwargs)

    async def patch(self, url, **kwargs):
        return await self.request("PATCH", url, **kwargs)

    async def delete(self, url, **kwargs):
        return await self.request("DELETE", url, **kwargs)

    async def head(self, url, **kwargs):
        return await self.request("HEAD", url, **kwargs)
