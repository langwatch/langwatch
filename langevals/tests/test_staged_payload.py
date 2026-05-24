"""Unit tests for langevals.staged_payload.StagedPayloadMiddleware.

The middleware swaps a request body with the contents of a presigned URL
when the X-Payload-S3-URL header is set. We stand up a tiny FastAPI app
with one POST route, mount the middleware, and exercise each branch with
Starlette's TestClient. httpx is monkey-patched to a transport that
serves the staged payload from an in-memory buffer so the test stays
network-free.
"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi import FastAPI
from pydantic import BaseModel
from starlette.testclient import TestClient

from langevals.staged_payload import StagedPayloadMiddleware


class _Echo(BaseModel):
    name: str
    payload: dict


def _build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(StagedPayloadMiddleware)

    @app.post("/echo")
    def echo(body: _Echo) -> dict:
        return {"received": body.model_dump()}

    return app


def _patch_httpx(monkeypatch: pytest.MonkeyPatch, handler):
    transport = httpx.MockTransport(handler)
    original_init = httpx.AsyncClient.__init__

    def patched_init(self, *args, **kwargs):
        kwargs.pop("transport", None)
        original_init(self, *args, transport=transport, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched_init)


class TestStagedPayloadMiddleware:
    def test_inline_request_without_header_is_unchanged(self):
        client = TestClient(_build_app())

        response = client.post(
            "/echo", json={"name": "inline", "payload": {"k": "v"}}
        )

        assert response.status_code == 200
        assert response.json() == {
            "received": {"name": "inline", "payload": {"k": "v"}}
        }

    def test_staged_request_fetches_body_from_presigned_url(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        staged_body = json.dumps(
            {"name": "staged", "payload": {"trace_count": 9000}}
        ).encode()

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "GET"
            assert request.url.host == "s3.example"
            return httpx.Response(
                200,
                content=staged_body,
                headers={"Content-Length": str(len(staged_body))},
            )

        _patch_httpx(monkeypatch, handler)

        client = TestClient(_build_app())
        response = client.post(
            "/echo",
            headers={"X-Payload-S3-URL": "https://s3.example/staging/k.json"},
        )

        assert response.status_code == 200
        assert response.json() == {
            "received": {"name": "staged", "payload": {"trace_count": 9000}}
        }

    def test_staged_request_above_max_returns_413(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setenv("LANGEVALS_STAGED_MAX_BYTES", "32")

        import importlib

        import langevals.staged_payload as staged_module

        importlib.reload(staged_module)

        app = FastAPI()
        app.add_middleware(staged_module.StagedPayloadMiddleware)

        @app.post("/echo")
        def echo(body: _Echo) -> dict:  # pragma: no cover — should not be hit
            return {"received": body.model_dump()}

        oversized = b"x" * 1024

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                content=oversized,
                headers={"Content-Length": str(len(oversized))},
            )

        _patch_httpx(monkeypatch, handler)

        client = TestClient(app)
        response = client.post(
            "/echo",
            headers={"X-Payload-S3-URL": "https://s3.example/staging/big.json"},
        )

        assert response.status_code == 413
        assert "exceeds" in response.json()["detail"]

        importlib.reload(staged_module)

    def test_staged_request_fetch_failure_returns_502(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(403, content=b"Forbidden")

        _patch_httpx(monkeypatch, handler)

        client = TestClient(_build_app())
        response = client.post(
            "/echo",
            headers={"X-Payload-S3-URL": "https://s3.example/staging/gone.json"},
        )

        assert response.status_code == 502
        assert "X-Payload-S3-URL" in response.json()["detail"]
