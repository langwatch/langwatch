import os

from typing import Any, Dict, Optional, Sequence

from opentelemetry import trace
from opentelemetry.sdk import trace as trace_api
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import SimpleSpanProcessor

from .typings import Instrumentor

class Client:
	"""
	Client for the LangWatch tracing SDK.
	"""

	tracer_provider: Optional[TracerProvider] = None

	api_key: str
	endpoint_url: str
	instrumentors: Sequence[Instrumentor] = []
	base_attributes: Dict[str, Any] = {}

	def __init__(
		self,
		api_key: Optional[str] = None,
		endpoint_url: Optional[str] = None,
		base_attributes: Optional[Dict[str, Any]] = None,
		instrumentors: Optional[Sequence[Instrumentor]] = None,
		tracer_provider: Optional[TracerProvider] = None,
	):
		"""
		Initialize the LangWatch tracing client.

		Args:
			api_key: Optional. The API key for the LangWatch tracing service, if none is provided, the `LANGWATCH_API_KEY` environment variable will be used.
			endpoint_url: Optional. The URL of the LangWatch tracing service, if none is provided, the `LANGWATCH_ENDPOINT_URL` environment variable will be used. If that is not provided, the default value will be `https://app.langwatch.ai`.
			base_attributes: Optional. The base attributes to use for the LangWatch tracing client.
			instrumentors: Optional. The instrumentors to use for the LangWatch tracing client.

			tracer_provider: Optional. The tracer provider to use for the LangWatch tracing client. If none is provided, the global tracer provider will be used. If that does not exist, a new tracer provider will be created.
		"""

		self.api_key = api_key or os.getenv("LANGWATCH_API_KEY")
		self.endpoint_url = endpoint_url or os.getenv("LANGWATCH_ENDPOINT_URL") or "https://app.langwatch.ai"
		self.base_attributes = base_attributes or {}

		self.tracer_provider = self.__ensure_otel_setup(self.endpoint_url, tracer_provider)

		self.instrumentors = instrumentors or []
		for instrumentor in self.instrumentors:
			instrumentor.instrument(tracer_provider=tracer_provider)

	# TODO(afr): How do we handle merging the tracer provider if one exists, with the
	# base attributes?
	def __ensure_otel_setup(self, endpoint_url: str, tracer_provider: Optional[TracerProvider] = None) -> TracerProvider:
		# Check provided tracer provider
		if tracer_provider is not None:
			trace.set_tracer_provider(tracer_provider)
			return tracer_provider

		# Check global tracer provider
		global_provider = trace.get_tracer_provider()
		if global_provider is not None and not isinstance(global_provider, trace.ProxyTracerProvider):
			return global_provider

		# Setup new tracer provider and set globally
		resource = Resource.create(self.base_attributes)
		tracer_provider = trace_api.TracerProvider(resource=resource)
		tracer_provider.add_span_processor(SimpleSpanProcessor(OTLPSpanExporter(
			endpoint=f"{endpoint_url}/api/otel/v1/traces",
			headers={
				"Authorization": f"Bearer {self.api_key}",
			},
		)))
		trace.set_tracer_provider(tracer_provider)

		return tracer_provider

