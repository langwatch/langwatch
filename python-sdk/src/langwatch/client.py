import atexit
import os
import logging
from typing import List, Optional, Sequence

from langwatch.__version__ import __version__
from langwatch.attributes import AttributeKey
from langwatch.domain import BaseAttributes, SpanProcessingExcludeRule
from langwatch.state import get_instance
from opentelemetry import trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased, ALWAYS_OFF
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
from opentelemetry.sdk.trace import ReadableSpan


from .exporters.filterable_batch_span_exporter import FilterableBatchSpanProcessor
from .types import LangWatchClientProtocol

from .generated.langwatch_rest_api_client import Client as LangWatchApiClient

import opentelemetry.trace
from opentelemetry.util._once import Once

logger = logging.getLogger(__name__)


class Client(LangWatchClientProtocol):
    """
    Client for the LangWatch tracing SDK.
    """

    # Class variables - shared across all instances
    _instance: Optional["Client"] = None
    _debug: bool = False
    _api_key: str = ""
    _endpoint_url: str = ""
    _base_attributes: BaseAttributes = {}
    _instrumentors: Sequence[BaseInstrumentor] = []
    _disable_sending: bool = False
    _flush_on_exit: bool = True
    _span_exclude_rules: List[SpanProcessingExcludeRule] = []
    _ignore_global_tracer_provider_override_warning: bool = False
    _skip_open_telemetry_setup: bool = False
    _tracer_provider: Optional[TracerProvider] = None
    _rest_api_client: Optional[LangWatchApiClient] = None
    _registered_instrumentors: dict[
        opentelemetry.trace.TracerProvider, set[BaseInstrumentor]
    ] = {}

    # Regular attributes for protocol compatibility
    base_attributes: BaseAttributes = {}
    tracer_provider: Optional[TracerProvider] = None
    instrumentors: Sequence[BaseInstrumentor] = []

    def __init__(
        self,
        api_key: Optional[str] = None,
        endpoint_url: Optional[str] = None,
        base_attributes: Optional[BaseAttributes] = None,
        instrumentors: Optional[Sequence[BaseInstrumentor]] = None,
        tracer_provider: Optional[TracerProvider] = None,
        debug: Optional[bool] = None,
        disable_sending: Optional[bool] = None,
        flush_on_exit: Optional[bool] = None,
        span_exclude_rules: Optional[List[SpanProcessingExcludeRule]] = None,
        ignore_global_tracer_provider_override_warning: Optional[bool] = None,
        skip_open_telemetry_setup: Optional[bool] = None,
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
                skip_open_telemetry_setup: Optional. If True, OpenTelemetry setup will be skipped entirely. This is useful when you want to handle OpenTelemetry setup yourself.
        """

        # Check if an instance already exists
        if Client._instance is not None:
            debug_flag = debug or os.getenv("LANGWATCH_DEBUG") == "true"
            if debug_flag:
                logger.debug("Returning existing LangWatch client instance")
            # Return the existing instance directly
            existing = Client._instance
            # Update the existing instance with any new parameters
            if api_key is not None:
                existing._api_key = api_key
            if endpoint_url is not None:
                existing._endpoint_url = endpoint_url
            if debug is not None:
                existing._debug = debug
            if disable_sending is not None:
                existing._disable_sending = disable_sending
            if flush_on_exit is not None:
                existing._flush_on_exit = flush_on_exit
            if span_exclude_rules is not None:
                existing._span_exclude_rules = span_exclude_rules
            if ignore_global_tracer_provider_override_warning is not None:
                existing._ignore_global_tracer_provider_override_warning = ignore_global_tracer_provider_override_warning
            if skip_open_telemetry_setup is not None:
                existing._skip_open_telemetry_setup = skip_open_telemetry_setup
            if base_attributes is not None:
                existing._base_attributes = base_attributes
            if instrumentors is not None:
                existing._instrumentors = instrumentors
            if tracer_provider is not None:
                existing._tracer_provider = tracer_provider
            # Copy the existing instance's attributes to this instance and return
            self.__dict__.update(existing.__dict__)
            return

        # Store this instance as the singleton
        Client._instance = self

        # Update class variables with provided values or environment defaults
        if api_key is not None:
            self._api_key = api_key
        elif not self._api_key:
            self._api_key = os.getenv("LANGWATCH_API_KEY", "")

        if endpoint_url is not None:
            self._endpoint_url = endpoint_url
        elif not self._endpoint_url:
            self._endpoint_url = (
                os.getenv("LANGWATCH_ENDPOINT") or "https://app.langwatch.ai"
            )

        if debug is not None:
            self._debug = debug
        elif not self._debug:
            self._debug = os.getenv("LANGWATCH_DEBUG") == "true"

        if disable_sending is not None:
            self._disable_sending = disable_sending

        if flush_on_exit is not None:
            self._flush_on_exit = flush_on_exit

        if span_exclude_rules is not None:
            self._span_exclude_rules = span_exclude_rules

        if ignore_global_tracer_provider_override_warning is not None:
            self._ignore_global_tracer_provider_override_warning = (
                ignore_global_tracer_provider_override_warning
            )

        if skip_open_telemetry_setup is not None:
            self._skip_open_telemetry_setup = skip_open_telemetry_setup

        if base_attributes is not None:
            self._base_attributes = base_attributes
        elif not self._base_attributes:
            self._base_attributes = {}

        if instrumentors is not None:
            self._instrumentors = instrumentors
        elif not self._instrumentors:
            self._instrumentors = []

        if tracer_provider is not None:
            self._tracer_provider = tracer_provider

        # Set up base attributes with SDK info
        self._base_attributes[AttributeKey.LangWatchSDKName] = (
            "langwatch-observability-sdk"
        )
        self._base_attributes[AttributeKey.LangWatchSDKVersion] = str(__version__)
        self._base_attributes[AttributeKey.LangWatchSDKLanguage] = "python"

        # Set up OpenTelemetry if not skipped
        if not self._skip_open_telemetry_setup:
            self._tracer_provider = self.__ensure_otel_setup(self._tracer_provider)
        elif self._debug:
            logger.debug("Skipping OpenTelemetry setup as requested")

        # Run instrumentors only if they haven't been registered with the current tracer provider
        current_tracer_provider = self._tracer_provider or trace.get_tracer_provider()
        if current_tracer_provider not in self._registered_instrumentors:
            self._registered_instrumentors[current_tracer_provider] = set()

        for instrumentor in self._instrumentors:
            if (
                instrumentor
                not in self._registered_instrumentors[current_tracer_provider]
            ):
                instrumentor.instrument(tracer_provider=current_tracer_provider)
                self._registered_instrumentors[current_tracer_provider].add(
                    instrumentor
                )

        # Set instance attributes for protocol compatibility
        self.base_attributes = self._base_attributes
        self.tracer_provider = self._tracer_provider
        self.instrumentors = self._instrumentors

        self._setup_rest_api_client()

    @classmethod
    def _get_instance(cls) -> Optional["Client"]:
        """Get the singleton instance of the LangWatch client. Internal use only."""
        return cls._instance

    @classmethod
    def _create_instance(
        cls,
        api_key: Optional[str] = None,
        endpoint_url: Optional[str] = None,
        base_attributes: Optional[BaseAttributes] = None,
        instrumentors: Optional[Sequence[BaseInstrumentor]] = None,
        tracer_provider: Optional[TracerProvider] = None,
        debug: Optional[bool] = None,
        disable_sending: Optional[bool] = None,
        flush_on_exit: Optional[bool] = True,
        span_exclude_rules: Optional[List[SpanProcessingExcludeRule]] = None,
        ignore_global_tracer_provider_override_warning: Optional[bool] = None,
        skip_open_telemetry_setup: Optional[bool] = None,
    ) -> "Client":
        """Create or get the singleton instance of the LangWatch client. Internal use only."""
        if cls._instance is None:
            cls._instance = cls(
                api_key=api_key,
                endpoint_url=endpoint_url,
                base_attributes=base_attributes,
                instrumentors=instrumentors,
                tracer_provider=tracer_provider,
                debug=debug,
                disable_sending=disable_sending,
                flush_on_exit=flush_on_exit,
                span_exclude_rules=span_exclude_rules,
                ignore_global_tracer_provider_override_warning=ignore_global_tracer_provider_override_warning,
                skip_open_telemetry_setup=skip_open_telemetry_setup,
            )
        return cls._instance

    @classmethod
    def _reset_instance(cls) -> None:
        """Reset the singleton instance. Internal use only, primarily for testing."""
        if cls._instance is not None:
            # Shutdown the existing instance if it has a tracer provider
            if (
                hasattr(cls._instance, "tracer_provider")
                and cls._instance.tracer_provider
            ):
                cls._instance.__shutdown_tracer_provider()
            cls._instance = None
        
        # Reset all class variables to their default values
        cls._debug = False
        cls._api_key = ""
        cls._endpoint_url = ""
        cls._base_attributes = {}
        cls._instrumentors = []
        cls._disable_sending = False
        cls._flush_on_exit = True
        cls._span_exclude_rules = []
        cls._ignore_global_tracer_provider_override_warning = False
        cls._skip_open_telemetry_setup = False
        cls._tracer_provider = None
        cls._rest_api_client = None
        cls._registered_instrumentors.clear()

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

        api_key_has_changed = bool(self._api_key)

        self._api_key = value

        if api_key_has_changed and not self._skip_open_telemetry_setup:
            # Shut down any existing tracer provider, as API key change requires re-initialization.
            self.__shutdown_tracer_provider()

            # HACK: set global tracer provider to a proxy tracer provider back
            opentelemetry.trace._TRACER_PROVIDER = None  # type: ignore
            opentelemetry.trace._TRACER_PROVIDER_SET_ONCE = Once()  # type: ignore

            # If a new API key is provided and sending is not disabled, set up a new tracer provider.
            if value and not self._disable_sending:
                self.__setup_tracer_provider()

        if value:
            self._setup_rest_api_client()

    @property
    def disable_sending(self) -> bool:
        """Get whether sending is disabled."""
        return self._disable_sending

    @property
    def rest_api_client(self) -> LangWatchApiClient:
        """Get the REST API client for the client."""
        if self._rest_api_client is None:
            raise RuntimeError(
                "REST API client not initialized. Call _setup_rest_api_client() first."
            )
        return self._rest_api_client

    @property
    def skip_open_telemetry_setup(self) -> bool:
        """Get whether OpenTelemetry setup is skipped."""
        return self._skip_open_telemetry_setup

    @disable_sending.setter
    def disable_sending(self, value: bool) -> None:
        """Set whether sending is disabled. If enabling, this will create a new global tracer provider."""
        if self._disable_sending == value:
            return

        # force flush the tracer provider before changing the disable_sending flag
        if self._tracer_provider and not self._skip_open_telemetry_setup:
            self._tracer_provider.force_flush()

        self._disable_sending = value

    def __shutdown_tracer_provider(self) -> None:
        """Shuts down the current tracer provider, including flushing."""
        if self._tracer_provider:
            if self._flush_on_exit:
                try:
                    # Unregister the atexit hook if it was registered.
                    atexit.unregister(self._tracer_provider.force_flush)
                except ValueError:
                    pass  # Handler was never registered or already unregistered.

            if hasattr(self._tracer_provider, "force_flush") and callable(
                getattr(self._tracer_provider, "force_flush")
            ):
                if self._debug:
                    logger.debug("Forcing flush of tracer provider before shutdown.")
                self._tracer_provider.force_flush()

            if self._debug:
                logger.debug("Shutting down tracer provider.")
            self._tracer_provider.shutdown()
            self._tracer_provider = None

    def __setup_tracer_provider(self) -> None:
        """Sets up the tracer provider if not already active."""
        if self._skip_open_telemetry_setup:
            if self._debug:
                logger.debug("Skipping tracer provider setup as requested.")
            return

        if not self._tracer_provider:
            if self._debug:
                logger.debug("Setting up new tracer provider.")
            self._tracer_provider = self.__ensure_otel_setup()

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
            resource = Resource.create(self._base_attributes)
            sampler = ALWAYS_OFF if self._disable_sending else TraceIdRatioBased(1.0)
            provider = TracerProvider(resource=resource, sampler=sampler)

            # Only set up LangWatch exporter if sending is not disabled
            if not self._disable_sending:
                self.__set_langwatch_exporter(provider)

            if self._flush_on_exit:
                logger.info(
                    "Registering atexit handler to flush tracer provider on exit"
                )
                atexit.register(provider.force_flush)

            if self._debug:
                logger.info(
                    "Successfully configured tracer provider with OTLP exporter"
                )

            return provider
        except Exception as e:
            raise RuntimeError(
                f"Failed to create and configure tracer provider: {str(e)}"
            ) from e

    def __set_langwatch_exporter(self, provider: TracerProvider) -> None:
        if not self._api_key:
            raise ValueError("LangWatch API key is required but not provided")

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "X-LangWatch-SDK-Version": str(__version__),
        }

        if self._debug:
            logger.info(
                f"Configuring OTLP exporter with endpoint: {self._endpoint_url}/api/otel/v1/traces"
            )

        otlp_exporter = OTLPSpanExporter(
            endpoint=f"{self._endpoint_url}/api/otel/v1/traces",
            headers=headers,
            timeout=int(os.getenv("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", 30)),
        )

        # Wrap the exporter with conditional logic
        conditional_exporter = ConditionalSpanExporter(
            wrapped_exporter=otlp_exporter,
        )

        processor = FilterableBatchSpanProcessor(
            span_exporter=conditional_exporter,
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


class ConditionalSpanExporter(SpanExporter):
    def __init__(self, wrapped_exporter: SpanExporter):
        self.wrapped_exporter = wrapped_exporter

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        # Check your singleton's disable flag
        client = get_instance()
        if client and client.disable_sending:
            # Drop all spans - return success without sending
            return SpanExportResult.SUCCESS

        # Normal export
        return self.wrapped_exporter.export(spans)  # type: ignore

    def shutdown(self) -> None:
        return self.wrapped_exporter.shutdown()

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        client = get_instance()
        if client and client.disable_sending:
            return True  # Nothing to flush
        return self.wrapped_exporter.force_flush(timeout_millis)
