import atexit
import os
import logging
from typing import List, Optional, Sequence

from langwatch.__version__ import __version__
from langwatch.attributes import AttributeName
from langwatch.domain import SpanExporterExcludeRule
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased, ALWAYS_OFF

from .typings import Instrumentor
from .types import LangWatchClientProtocol, BaseAttributes

logger = logging.getLogger(__name__)

class Client(LangWatchClientProtocol):
	"""
	Client for the LangWatch tracing SDK.
	"""

	_debug: bool = False
	_api_key: str
	_endpoint_url: str
	instrumentors: Sequence[Instrumentor] = []
	base_attributes: BaseAttributes = {}
	_disable_sending: bool = False
	_flush_on_exit: bool = True
	_span_exporter_exclude_rules: List[SpanExporterExcludeRule] = []

	def __init__(
		self,
		api_key: Optional[str] = None,
		endpoint_url: Optional[str] = None,
		base_attributes: Optional[BaseAttributes] = None,
		instrumentors: Optional[Sequence[Instrumentor]] = None,
		tracer_provider: Optional[TracerProvider] = None,
		debug: bool = False,
		disable_sending: bool = False,
		flush_on_exit: bool = True,
		span_exporter_exclude_rules: Optional[List[SpanExporterExcludeRule]] = None,
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
			flush_on_exit: Optional. If True, the tracer provider will flush all spans when the program exits.
			span_exporter_exclude_rules: Optional. The rules to exclude from the span exporter.
		"""

		self._api_key = api_key or os.getenv("LANGWATCH_API_KEY", "")
		self._endpoint_url = endpoint_url or os.getenv("LANGWATCH_ENDPOINT") or "https://app.langwatch.ai"
		self._debug = debug or os.getenv("LANGWATCH_DEBUG") == "true"
		self._disable_sending = disable_sending
		self._flush_on_exit = flush_on_exit
		self._span_exporter_exclude_rules = span_exporter_exclude_rules or []

		self.base_attributes = base_attributes or {}
		self.base_attributes[AttributeName.LangWatchSDKName] = "langwatch-observability-sdk"
		self.base_attributes[AttributeName.LangWatchSDKVersion] = str(__version__)
		self.base_attributes[AttributeName.LangWatchSDKLanguage] = "python"

		self.tracer_provider = self.__ensure_otel_setup(tracer_provider)

		self.instrumentors = instrumentors or []
		for instrumentor in self.instrumentors:
			instrumentor.instrument(tracer_provider=self.tracer_provider)

	@property
	def debug(self) -> bool:
		"""Get the debug flag for the client."""
		return self._debug

	@debug.setter
	def debug(self, value: bool) -> None:
		"""Set the debug flag for the client."""
		self._debug = value

	@property
	def endpoint_url(self) -> str:
		"""Get the endpoint URL for the client."""
		return self._endpoint_url

	@property
	def flush_on_exit(self) -> bool:
		"""Get the flush on exit flag for the client."""
		return self._flush_on_exit

	@property
	def api_key(self) -> str:
		"""Get the API key for the client."""
		return self._api_key

	@property
	def disable_sending(self) -> bool:
		"""Get whether sending is disabled."""
		return self._disable_sending

	@disable_sending.setter
	def disable_sending(self, value: bool) -> None:
		"""Set whether sending is disabled. If enabling, this will create a new global tracer provider."""
		if self._disable_sending == value:
			return

		self._disable_sending = value

		if value:
			if self.tracer_provider:
				if self._flush_on_exit:
					atexit.unregister(self.tracer_provider.force_flush)
				self.tracer_provider.shutdown()
		else:
			self.tracer_provider = self.__ensure_otel_setup()

	def __ensure_otel_setup(self, tracer_provider: Optional[TracerProvider] = None) -> TracerProvider:
		try:
			if tracer_provider is not None:
				if not isinstance(tracer_provider, TracerProvider): # type: ignore
					raise ValueError("tracer_provider must be an instance of TracerProvider")
				trace.set_tracer_provider(tracer_provider)
				return tracer_provider

			global_provider = trace.get_tracer_provider()
			if global_provider is not None and not isinstance(global_provider, trace.ProxyTracerProvider): # type: ignore
				if not isinstance(global_provider, TracerProvider):
					raise ValueError("Global tracer provider must be an instance of TracerProvider")

				logger.warning("There is already a global tracer provider set. LangWatch will not override it automatically, but this may result in telemetry not being sent to LangWatch if you have not configured it to do so yourself.")

				return global_provider

			provider = self.__create_new_tracer_provider()
			trace.set_tracer_provider(provider)

			return provider

		except Exception as e:
			raise RuntimeError(f"Failed to setup OpenTelemetry tracer provider: {str(e)}") from e

	def __create_new_tracer_provider(self) -> TracerProvider:
		try:
			resource = Resource.create(self.base_attributes)
			sampler = ALWAYS_OFF if self._disable_sending else TraceIdRatioBased(1.0)
			provider = TracerProvider(resource=resource, sampler=sampler)

			if not self.api_key:
				raise ValueError("LangWatch API key is required but not provided")

			headers = {
				"Authorization": f"Bearer {self.api_key}",
				"X-LangWatch-SDK-Version": str(__version__),
			}

			if self.debug:
				logger.info(f"Configuring OTLP exporter with endpoint: {self._endpoint_url}/api/otel/v1/traces")

			otlp_exporter = OTLPSpanExporter(
				endpoint=f"{self._endpoint_url}/api/otel/v1/traces",
				headers=headers,
				timeout=int(os.getenv("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", 30)),
			)

			provider.add_span_processor(BatchSpanProcessor(
				span_exporter=otlp_exporter,
				max_export_batch_size=int(os.getenv("OTEL_BSP_MAX_EXPORT_BATCH_SIZE", 100)),
				max_queue_size=int(os.getenv("OTEL_BSP_MAX_QUEUE_SIZE", 512)),
				schedule_delay_millis=float(os.getenv("OTEL_BSP_SCHEDULE_DELAY", 1000)),
				export_timeout_millis=float(os.getenv("OTEL_BSP_EXPORT_TIMEOUT", 10000)),
			))

			if self._flush_on_exit:
				logger.info("Registering atexit handler to flush tracer provider on exit")
				atexit.register(provider.force_flush)

			if self.debug:
				logger.info("Successfully configured tracer provider with OTLP exporter")

			return provider
		except Exception as e:
			raise RuntimeError(f"Failed to create and configure tracer provider: {str(e)}") from e
