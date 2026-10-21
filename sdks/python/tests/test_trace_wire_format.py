"""The trace exporter sends gzipped OTLP/protobuf by default.

specs/observability/sdk-trace-wire-format.feature
"""

import gzip
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import ClassVar
from unittest.mock import patch

import pytest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)
from opentelemetry.sdk.trace import TracerProvider

from langwatch.client import Client

COMPRESSION_VARIABLES = (
    "OTEL_EXPORTER_OTLP_COMPRESSION",
    "OTEL_EXPORTER_OTLP_TRACES_COMPRESSION",
)


class _Receiver(BaseHTTPRequestHandler):
    """Stands in for LangWatch's /api/otel/v1/traces route."""

    received: ClassVar[list[tuple[dict[str, str], bytes]]] = []

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers["Content-Length"]))
        self.received.append((dict(self.headers), body))
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args) -> None:
        pass


@pytest.fixture
def receiver() -> Iterator[tuple[str, list[tuple[dict[str, str], bytes]]]]:
    _Receiver.received = []
    server = HTTPServer(("127.0.0.1", 0), _Receiver)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}", _Receiver.received
    server.shutdown()
    server.server_close()


# @scenario The Python SDK sends gzipped protobuf by default
def test_exporter_sends_gzipped_protobuf_by_default(monkeypatch, receiver) -> None:
    for name in COMPRESSION_VARIABLES:
        monkeypatch.delenv(name, raising=False)
    endpoint, received = receiver
    Client.reset_for_testing()
    provider = TracerProvider()

    Client(api_key="test-key", endpoint_url=endpoint, tracer_provider=provider)
    provider.get_tracer("wire-test").start_span("python.llm.chat").end()
    assert provider.force_flush()
    Client.reset_for_testing()

    assert len(received) == 1
    headers, body = received[0]
    assert headers["Content-Type"] == "application/x-protobuf"
    assert headers["Content-Encoding"] == "gzip"
    request = ExportTraceServiceRequest()
    request.ParseFromString(gzip.decompress(body))
    spans = request.resource_spans[0].scope_spans[0].spans
    assert [span.name for span in spans] == ["python.llm.chat"]


# @scenario The Python SDK leaves compression to the OTel variables when they are set
@pytest.mark.parametrize("name", COMPRESSION_VARIABLES)
def test_exporter_defers_to_the_compression_variables(monkeypatch, name) -> None:
    for other in COMPRESSION_VARIABLES:
        monkeypatch.delenv(other, raising=False)
    monkeypatch.setenv(name, "none")
    Client.reset_for_testing()

    with patch("langwatch.client.OTLPSpanExporter") as exporter:
        Client(api_key="test-key")

    assert exporter.call_args.kwargs["compression"] is None
