import os
import logging
import threading
from typing import Optional, Sequence, List
from requests.exceptions import RequestException

from langwatch.__version__ import __version__
from langwatch.attributes import AttributeName
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider, ReadableSpan
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor, SpanExportResult
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased, ALWAYS_OFF

from .typings import Instrumentor
from .types import LangWatchClientProtocol, BaseAttributes

logger = logging.getLogger(__name__)

class GracefulBatchSpanProcessor(BatchSpanProcessor):
	"""A BatchSpanProcessor that handles export failures gracefully by logging them instead of raising exceptions."""

	def __init__(self, *args, **kwargs):
		super().__init__(*args, **kwargs)
		self._lock = threading.Lock()
		self._export_lock = threading.Lock()

	def _export(self, spans: List[ReadableSpan]) -> None:
		"""
		Export the spans while handling errors gracefully.

		Args:
			spans: The list of spans to export.
		"""
		if not spans:
			return

		with self._export_lock:
			try:
				result = self.span_exporter.export(spans)
				logger.debug(f"Successfully exported {len(spans)} spans")

				if result != SpanExportResult.SUCCESS:
					logger.warning(f"Failed to export spans batch: got result {result}")

			except RequestException as ex:
				logger.warning(f"Network error while exporting spans: {str(ex)}")
			except Exception as ex:
				logger.error(f"Unexpected error in span export: {str(ex)}", exc_info=True)

	def _export_batch(self) -> None:
		"""Export the current batch of spans with proper cleanup."""
		spans_to_export = []
		
		with self._lock:
			if not self.spans_list:
				logger.debug("No spans to export in batch")
				return

			# Take all spans that are ready for export
			spans_to_export = [span for span in self.spans_list if span is not None]
			if spans_to_export:
				logger.debug(f"Preparing to export {len(spans_to_export)} spans")
				# Only remove the spans we're actually exporting
				self.spans_list = [span for span in self.spans_list if span not in spans_to_export]

		if spans_to_export:
			self._export(spans_to_export)

	def on_end(self, span: ReadableSpan) -> None:
		"""Called when a span is ended."""
		if span is None:
			return

		should_export = False
		with self._lock:
			self.spans_list.append(span)
			current_size = len(self.spans_list)
			logger.debug(f"Added span to export queue. Queue size: {current_size}")
			should_export = current_size >= self.max_export_batch_size

		if should_export:
			logger.debug("Batch size limit reached, forcing export")
			self._export_batch()

	def force_flush(self, timeout_millis: Optional[int] = None) -> bool:
		"""Force an export of all spans."""
		logger.debug("Force flushing spans")
		self._export_batch()
		return True

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
		self.base_attributes[AttributeName.LangWatchSDKName] = "langwatch-observability-sdk"
		self.base_attributes[AttributeName.LangWatchSDKVersion] = __version__
		self.base_attributes[AttributeName.LangWatchSDKLanguage] = "python"

		self.debug = debug

		self.tracer_provider = self.__ensure_otel_setup(tracer_provider)

		self.instrumentors = instrumentors or []
		for instrumentor in self.instrumentors:
			instrumentor.instrument(tracer_provider=self.tracer_provider)

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
		"""Set whether sending is disabled. If enabling, this will create a new global tracer provider."""
		if self._disable_sending == value:
			return

		self._disable_sending = value

		if value:
			self.tracer_provider.shutdown()
		else:
			self.tracer_provider = self.__ensure_otel_setup()

	def __ensure_otel_setup(self, tracer_provider: Optional[TracerProvider] = None) -> TracerProvider:
		try:
			if tracer_provider is not None:
				if not isinstance(tracer_provider, TracerProvider):
					raise ValueError("tracer_provider must be an instance of TracerProvider")
				trace.set_tracer_provider(tracer_provider)
				return tracer_provider

			global_provider = trace.get_tracer_provider()
			if global_provider is not None and not isinstance(global_provider, trace.ProxyTracerProvider):
				if not isinstance(global_provider, TracerProvider):
					raise ValueError("Global tracer provider must be an instance of TracerProvider")
				
				logger.warning("There is already a global tracer provider set. LangWatch will not override it automatically, but this may result in telemetry not being sent to LangWatch if you have not configured it to do so yourself.")

				return global_provider

			provider = self.__create_new_tracer_provider()
			trace.set_tracer_provider(provider)

			test_tracer = provider.get_tracer("langwatch-test", __version__)
			if test_tracer is None:
				raise RuntimeError("Failed to get tracer from newly created provider")
				
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
				"X-LangWatch-SDK-Version": __version__,
			}

			if self.debug:
				logger.info(f"Configuring OTLP exporter with endpoint: {self._endpoint_url}/api/otel/v1/traces")

			otlp_exporter = OTLPSpanExporter(
				endpoint=f"{self._endpoint_url}/api/otel/v1/traces",
				headers=headers,
				timeout=30,
			)

			# Configure processor with more aggressive settings
			processor = GracefulBatchSpanProcessor(
				span_exporter=otlp_exporter,
				max_queue_size=512,
				schedule_delay_millis=5000,
				max_export_batch_size=128,
			)

			provider.add_span_processor(processor)

			if self.debug:
				logger.info("Successfully configured tracer provider with OTLP exporter")

			return provider
		except Exception as e:
			raise RuntimeError(f"Failed to create and configure tracer provider: {str(e)}") from e
