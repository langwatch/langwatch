import os

from typing import Optional, Sequence

from langwatch.__version__ import __version__
from langwatch.attributes import AttributeName
from opentelemetry import trace
from opentelemetry.sdk import trace as trace_api
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased, ALWAYS_OFF

from .typings import Instrumentor
from .types import LangWatchClientProtocol, BaseAttributes

class Client(LangWatchClientProtocol):
	"""
	Client for the LangWatch tracing SDK.
	"""

	debug: bool = False
	api_key: str
	_endpoint_url: str
	instrumentors: Sequence[Instrumentor] = []
	base_attributes: BaseAttributes = {}
	_disable_sending: bool = False

	def __init__(
		self,
		api_key: Optional[str] = None,	
		endpoint_url: Optional[str] = None,
		base_attributes: Optional[BaseAttributes] = None,
		instrumentors: Optional[Sequence[Instrumentor]] = None,
		tracer_provider: Optional[TracerProvider] = None,
		debug: bool = False,
		disable_sending: bool = False,
	):
		"""
		Initialize the LangWatch tracing client.

		Args:
			api_key: Optional. The API key for the LangWatch tracing service, if none is provided, the `LANGWATCH_API_KEY` environment variable will be used.
			endpoint_url: Optional. The URL of the LangWatch tracing service, if none is provided, the `LANGWATCH_ENDPOINT` environment variable will be used. If that is not provided, the default value will be `https://app.langwatch.ai`.
			base_attributes: Optional. The base attributes to use for the LangWatch tracing client.
			instrumentors: Optional. The instrumentors to use for the LangWatch tracing client.
			tracer_provider: Optional. The tracer provider to use for the LangWatch tracing client. If none is provided, the global tracer provider will be used. If that does not exist, a new tracer provider will be created.
			disable_sending: Optional. If True, no traces will be sent to the server.
		"""

		self.api_key = api_key or os.getenv("LANGWATCH_API_KEY")
		self._endpoint_url = endpoint_url or os.getenv("LANGWATCH_ENDPOINT") or "https://app.langwatch.ai"
		self._disable_sending = disable_sending

		self.base_attributes = base_attributes or {}
		self.base_attributes[AttributeName.LangWatchSDKName] = "langwatch-python"
		self.base_attributes[AttributeName.LangWatchSDKVersion] = __version__
		self.base_attributes[AttributeName.LangWatchSDKLanguage] = "python"

		self.debug = debug

		self.tracer_provider = self.__ensure_otel_setup(tracer_provider)

		self.instrumentors = instrumentors or []
		for instrumentor in self.instrumentors:
			instrumentor.instrument(tracer_provider=tracer_provider)

	@property
	def endpoint_url(self) -> str:
		"""Get the endpoint URL for the client."""
		return self._endpoint_url

	@property
	def disable_sending(self) -> bool:
		"""Get whether sending is disabled."""
		return self._disable_sending

	@disable_sending.setter
	def disable_sending(self, value: bool) -> None:
		"""Set whether sending is disabled and update the tracer provider accordingly. This will create a new global tracer provider."""
		if self._disable_sending == value:
			return

		self._disable_sending = value

		if value:
			self.tracer_provider.shutdown()
		else:
			self.tracer_provider = self.__create_new_tracer_provider()

	def __ensure_otel_setup(self, tracer_provider: Optional[TracerProvider] = None) -> TracerProvider:
		# Check provided tracer provider
		if tracer_provider is not None:
			trace.set_tracer_provider(tracer_provider)
			return tracer_provider

		# Check global tracer provider
		global_provider = trace.get_tracer_provider()
		if global_provider is not None and not isinstance(global_provider, trace.ProxyTracerProvider):
			return global_provider

		return self.__create_new_tracer_provider()
	
	def __create_new_tracer_provider(self) -> TracerProvider:
		resource = Resource.create(self.base_attributes)
		sampler = ALWAYS_OFF if self._disable_sending else TraceIdRatioBased(1.0)
		tracer_provider = trace_api.TracerProvider(resource=resource, sampler=sampler)
		tracer_provider.add_span_processor(SimpleSpanProcessor(OTLPSpanExporter(
			endpoint=f"{self._endpoint_url}/api/otel/v1/traces",
			headers={
				"Authorization": f"Bearer {self.api_key}",
			},
		)))

		trace.set_tracer_provider(tracer_provider)

		return tracer_provider
