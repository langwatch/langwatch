import atexit
import os
import logging
from typing import List, Optional, Sequence

from langwatch.__version__ import __version__
from langwatch.attributes import AttributeKey
from langwatch.domain import BaseAttributes, SpanProcessingExcludeRule
from opentelemetry import trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased, ALWAYS_OFF

from .exporters.filterable_batch_span_exporter import FilterableBatchSpanProcessor
from .types import LangWatchClientProtocol

from .generated.langwatch_rest_api_client import Client as LangWatchApiClient


logger = logging.getLogger(__name__)


class Client(LangWatchClientProtocol):
    """
    Client for the LangWatch tracing SDK.
    """

    _debug: bool = False
    _api_key: str
    _endpoint_url: str
    instrumentors: Sequence[BaseInstrumentor] = []
    base_attributes: BaseAttributes = {}
    _disable_sending: bool = False
    _flush_on_exit: bool = True
    _span_exclude_rules: List[SpanProcessingExcludeRule] = []
    _ignore_global_tracer_provider_override_warning: bool = False
    _rest_api_client: LangWatchApiClient

    def __init__(
        self,
        api_key: Optional[str] = None,
        endpoint_url: Optional[str] = None,
        base_attributes: Optional[BaseAttributes] = None,
        instrumentors: Optional[Sequence[BaseInstrumentor]] = None,
        tracer_provider: Optional[TracerProvider] = None,
        debug: bool = False,
        disable_sending: bool = False,
        flush_on_exit: bool = True,
        span_exclude_rules: Optional[List[SpanProcessingExcludeRule]] = None,
        ignore_global_tracer_provider_override_warning: bool = False,
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
                span_exclude_rules: Optional. The rules to exclude from the span exporter.
                ignore_global_tracer_provider_override_warning: Optional. If True, the warning about the global tracer provider being overridden will be ignored.
        """

        self._api_key = api_key or os.getenv("LANGWATCH_API_KEY", "")
        self._endpoint_url = (
            endpoint_url
            or os.getenv("LANGWATCH_ENDPOINT")
            or "https://app.langwatch.ai"
        )
        self._debug = debug or os.getenv("LANGWATCH_DEBUG") == "true"
        self._disable_sending = disable_sending
        self._flush_on_exit = flush_on_exit
        self._span_exclude_rules = span_exclude_rules or []
        self._ignore_global_tracer_provider_override_warning = (
            ignore_global_tracer_provider_override_warning
        )
        self.base_attributes = base_attributes or {}
        self.base_attributes[AttributeKey.LangWatchSDKName] = (
            "langwatch-observability-sdk"
        )
        self.base_attributes[AttributeKey.LangWatchSDKVersion] = str(__version__)
        self.base_attributes[AttributeKey.LangWatchSDKLanguage] = "python"

        self.tracer_provider = self.__ensure_otel_setup(tracer_provider)

        self.instrumentors = instrumentors or []
        for instrumentor in self.instrumentors:
            instrumentor.instrument(tracer_provider=self.tracer_provider)

        self._setup_rest_api_client()

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

    @api_key.setter
    def api_key(self, value: str) -> None:
        """Set the API key for the client."""
        if value == self._api_key:
            return

        self._api_key = value

        # Shut down any existing tracer provider, as API key change requires re-initialization.
        self.__shutdown_tracer_provider()

        # If a new API key is provided and sending is not disabled, set up a new tracer provider.
        if self._api_key and not self._disable_sending:
            self.__setup_tracer_provider()

        if self._api_key:
            self._setup_rest_api_client()

    @property
    def disable_sending(self) -> bool:
        """Get whether sending is disabled."""
        return self._disable_sending

    @property
    def rest_api_client(self) -> LangWatchApiClient:
        """Get the REST API client for the client."""
        return self._rest_api_client

    @disable_sending.setter
    def disable_sending(self, value: bool) -> None:
        """Set whether sending is disabled. If enabling, this will create a new global tracer provider."""
        if self._disable_sending == value:
            return

        self._disable_sending = value

        # Use the new helper methods to manage the tracer provider
        if value:  # if disable_sending is True
            self.__shutdown_tracer_provider()
        else:  # if disable_sending is False
            self.__setup_tracer_provider()

    def __shutdown_tracer_provider(self) -> None:
        """Shuts down the current tracer provider, including flushing."""
        if self.tracer_provider:
            if self._flush_on_exit:
                try:
                    # Unregister the atexit hook if it was registered.
                    atexit.unregister(self.tracer_provider.force_flush)
                except ValueError:
                    pass  # Handler was never registered or already unregistered.

            if hasattr(self.tracer_provider, "force_flush") and callable(
                getattr(self.tracer_provider, "force_flush")
            ):
                if self._debug:
                    logger.debug("Forcing flush of tracer provider before shutdown.")
                self.tracer_provider.force_flush()

            if self._debug:
                logger.debug("Shutting down tracer provider.")
            self.tracer_provider.shutdown()
            self.tracer_provider = None

    def __setup_tracer_provider(self) -> None:
        """Sets up the tracer provider if not already active."""
        if not self.tracer_provider:
            if self._debug:
                logger.debug("Setting up new tracer provider.")
            self.tracer_provider = self.__ensure_otel_setup()

            return

        if self._debug:
            logger.debug("Tracer provider already active, not setting up again.")

    def __ensure_otel_setup(
        self, tracer_provider: Optional[TracerProvider] = None
    ) -> TracerProvider:
        settable_tracer_provider = (
            tracer_provider or self.__create_new_tracer_provider()
        )

        try:
            global_provider = trace.get_tracer_provider()
            if isinstance(global_provider, trace.ProxyTracerProvider):
                trace.set_tracer_provider(settable_tracer_provider)
                return settable_tracer_provider

            if not self._ignore_global_tracer_provider_override_warning:
                logger.warning(
                    "An existing global trace provider was found. LangWatch will not override it automatically, but instead is attaching another span processor and exporter to it. You can disable this warning by setting `ignore_global_tracer_provider_override_warning` to `True`."
                )
            self.__set_langwatch_exporter(settable_tracer_provider)

            return settable_tracer_provider

        except Exception as e:
            raise RuntimeError(
                f"Failed to setup OpenTelemetry tracer provider: {str(e)}"
            ) from e

    def __create_new_tracer_provider(self) -> TracerProvider:
        try:
            resource = Resource.create(self.base_attributes)
            sampler = ALWAYS_OFF if self._disable_sending else TraceIdRatioBased(1.0)
            provider = TracerProvider(resource=resource, sampler=sampler)

            self.__set_langwatch_exporter(provider)

            if self._flush_on_exit:
                logger.info(
                    "Registering atexit handler to flush tracer provider on exit"
                )
                atexit.register(provider.force_flush)

            if self.debug:
                logger.info(
                    "Successfully configured tracer provider with OTLP exporter"
                )

            return provider
        except Exception as e:
            raise RuntimeError(
                f"Failed to create and configure tracer provider: {str(e)}"
            ) from e

    def __set_langwatch_exporter(self, provider: TracerProvider) -> None:
        if not self.api_key:
            raise ValueError("LangWatch API key is required but not provided")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "X-LangWatch-SDK-Version": str(__version__),
        }

        if self.debug:
            logger.info(
                f"Configuring OTLP exporter with endpoint: {self._endpoint_url}/api/otel/v1/traces"
            )

        otlp_exporter = OTLPSpanExporter(
            endpoint=f"{self._endpoint_url}/api/otel/v1/traces",
            headers=headers,
            timeout=int(os.getenv("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", 30)),
        )

        processor = FilterableBatchSpanProcessor(
            span_exporter=otlp_exporter,
            exclude_rules=self._span_exclude_rules,
            max_export_batch_size=int(os.getenv("OTEL_BSP_MAX_EXPORT_BATCH_SIZE", 100)),
            max_queue_size=int(os.getenv("OTEL_BSP_MAX_QUEUE_SIZE", 512)),
            schedule_delay_millis=float(os.getenv("OTEL_BSP_SCHEDULE_DELAY", 1000)),
            export_timeout_millis=float(os.getenv("OTEL_BSP_EXPORT_TIMEOUT", 10000)),
        )
        provider.add_span_processor(processor)

    def _setup_rest_api_client(self) -> LangWatchApiClient:
        """
        Sets up the REST API client for the client.
        """
        self._rest_api_client = LangWatchApiClient(
            base_url=self._endpoint_url,
            headers={"X-Auth-Token": self._api_key},
            raise_on_unexpected_status=True,
        )

        return self._rest_api_client
