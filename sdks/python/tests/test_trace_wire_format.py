"""The trace exporter sends gzipped OTLP/protobuf by default.

specs/observability/sdk-trace-wire-format.feature
"""

from unittest.mock import patch

import pytest
from opentelemetry.exporter.otlp.proto.http import Compression

from langwatch.client import Client

COMPRESSION_VARIABLES = (
    "OTEL_EXPORTER_OTLP_COMPRESSION",
    "OTEL_EXPORTER_OTLP_TRACES_COMPRESSION",
)


# @scenario The Python SDK sends gzipped protobuf by default
def test_exporter_sends_gzipped_protobuf_by_default(monkeypatch) -> None:
    for name in COMPRESSION_VARIABLES:
        monkeypatch.delenv(name, raising=False)
    Client.reset_for_testing()

    with patch("langwatch.client.OTLPSpanExporter") as exporter:
        Client(api_key="test-key")

    assert exporter.call_args.kwargs["compression"] is Compression.Gzip


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
