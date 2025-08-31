import atexit
import os
import logging
from typing import List, Optional, Sequence, ClassVar

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

logger: logging.Logger = logging.getLogger(__name__)


class Client(LangWatchClientProtocol):
    """
    Client for the LangWatch tracing SDK.
    """

    # Class variables - shared across all instances
    _instance: ClassVar[Optional["Client"]] = None
    _debug: ClassVar[bool] = False
    _api_key: ClassVar[str] = ""
    _endpoint_url: ClassVar[str] = ""
    _base_attributes: ClassVar[BaseAttributes] = {}
    _instrumentors: ClassVar[Sequence[BaseInstrumentor]] = ()
    _disable_sending: ClassVar[bool] = False
    _flush_on_exit: ClassVar[bool] = True
    _span_exclude_rules: ClassVar[List[SpanProcessingExcludeRule]] = []  # type: ignore[misc]
    _ignore_global_tracer_provider_override_warning: ClassVar[bool] = False
    _skip_open_telemetry_setup: ClassVar[bool] = False
    _tracer_provider: ClassVar[Optional[TracerProvider]] = None
    _rest_api_client: ClassVar[Optional[LangWatchApiClient]] = None
    _registered_instrumentors: ClassVar[
        dict[opentelemetry.trace.TracerProvider, set[BaseInstrumentor]]
    ] = {}

    # Regular attributes for protocol compatibility
    base_attributes: BaseAttributes
    tracer_provider: Optional[TracerProvider]
    instrumentors: Sequence[BaseInstrumentor]

    def __new__(
        cls,
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
    ) -> "Client":
        """Ensure only one instance of Client exists (singleton pattern)."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

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

        # Check if this instance has already been initialized
        if hasattr(self, "_initialized"):
            # Instance already exists, update it with new parameters
            debug_flag = debug or os.getenv("LANGWATCH_DEBUG") == "true"
            if debug_flag:
                logger.debug("Updating existing LangWatch client instance")

            # Update via public setters so side-effects run
            if api_key is not None and api_key != self.api_key:
                self.api_key = api_key
            if endpoint_url is not None and endpoint_url != Client._endpoint_url:
                Client._endpoint_url = endpoint_url
                if (
                    not Client._skip_open_telemetry_setup
                    and not Client._disable_sending
                ):
                    self.__shutdown_tracer_provider()
                    self.__setup_tracer_provider()
            if debug is not None:
                Client._debug = debug
            if (
                disable_sending is not None
                and disable_sending != Client._disable_sending
            ):
                self.disable_sending = disable_sending
            if flush_on_exit is not None:
                Client._flush_on_exit = flush_on_exit
            if span_exclude_rules is not None:
                Client._span_exclude_rules = span_exclude_rules
            if ignore_global_tracer_provider_override_warning is not None:
                Client._ignore_global_tracer_provider_override_warning = (
                    ignore_global_tracer_provider_override_warning
                )
            if skip_open_telemetry_setup is not None:
                Client._skip_open_telemetry_setup = skip_open_telemetry_setup
            if base_attributes is not None:
                Client._base_attributes = base_attributes
                # Ensure required SDK attributes remain present after reconfiguration
                Client._base_attributes[AttributeKey.LangWatchSDKName] = (
                    "langwatch-observability-sdk"
                )
                Client._base_attributes[AttributeKey.LangWatchSDKVersion] = str(
                    __version__
                )
                Client._base_attributes[AttributeKey.LangWatchSDKLanguage] = "python"
            if instrumentors is not None:
                Client._instrumentors = instrumentors
            if tracer_provider is not None:
                Client._tracer_provider = tracer_provider
            # Ensure OTEL is configured and instrumentors are registered for the active provider
            if not Client._skip_open_telemetry_setup:
                Client._tracer_provider = self.__ensure_otel_setup(
                    Client._tracer_provider
                )
            current_tracer_provider = (
                Client._tracer_provider or trace.get_tracer_provider()
            )
            if current_tracer_provider not in Client._registered_instrumentors:
                Client._registered_instrumentors[current_tracer_provider] = set()
            for instrumentor in Client._instrumentors:
                if (
                    instrumentor
                    not in Client._registered_instrumentors[current_tracer_provider]
                ):
                    instrumentor.instrument(tracer_provider=current_tracer_provider)
                    Client._registered_instrumentors[current_tracer_provider].add(
                        instrumentor
                    )
            # Refresh REST client for endpoint/api-key updates
            self._setup_rest_api_client()
            return

        # Mark this instance as initialized
        self._initialized = True

        # Update class variables with provided values or environment defaults
        if api_key is not None:
            Client._api_key = api_key
        elif not Client._api_key:
            Client._api_key = os.getenv("LANGWATCH_API_KEY", "")

        if endpoint_url is not None:
            Client._endpoint_url = endpoint_url
        elif not Client._endpoint_url:
            Client._endpoint_url = (
                os.getenv("LANGWATCH_ENDPOINT") or "https://app.langwatch.ai"
            )

        if debug is not None:
            Client._debug = debug
        elif not Client._debug:
            Client._debug = os.getenv("LANGWATCH_DEBUG") == "true"

        if disable_sending is not None:
            Client._disable_sending = disable_sending

        if flush_on_exit is not None:
            Client._flush_on_exit = flush_on_exit

        if span_exclude_rules is not None:
            Client._span_exclude_rules = span_exclude_rules

        if ignore_global_tracer_provider_override_warning is not None:
            Client._ignore_global_tracer_provider_override_warning = (
                ignore_global_tracer_provider_override_warning
            )

        if skip_open_telemetry_setup is not None:
            Client._skip_open_telemetry_setup = skip_open_telemetry_setup

        if base_attributes is not None:
            Client._base_attributes = base_attributes
        elif not Client._base_attributes:
            Client._base_attributes = {}

        if instrumentors is not None:
            Client._instrumentors = instrumentors
        elif not Client._instrumentors:
            Client._instrumentors = ()

        if tracer_provider is not None:
            Client._tracer_provider = tracer_provider

        # Set up base attributes with SDK info
        Client._base_attributes[AttributeKey.LangWatchSDKName] = (
            "langwatch-observability-sdk"
        )
        Client._base_attributes[AttributeKey.LangWatchSDKVersion] = str(__version__)
        Client._base_attributes[AttributeKey.LangWatchSDKLanguage] = "python"

        # Set up OpenTelemetry if not skipped
        if not Client._skip_open_telemetry_setup:
            Client._tracer_provider = self.__ensure_otel_setup(Client._tracer_provider)
        elif Client._debug:
            logger.debug("Skipping OpenTelemetry setup as requested")

        # Run instrumentors only if they haven't been registered with the current tracer provider
        current_tracer_provider = Client._tracer_provider or trace.get_tracer_provider()
        if current_tracer_provider not in Client._registered_instrumentors:
            Client._registered_instrumentors[current_tracer_provider] = set()

        for instrumentor in Client._instrumentors:
            if (
                instrumentor
                not in Client._registered_instrumentors[current_tracer_provider]
            ):
                instrumentor.instrument(tracer_provider=current_tracer_provider)
                Client._registered_instrumentors[current_tracer_provider].add(
                    instrumentor
                )

        # Initialize instance attributes for protocol compatibility
        self.base_attributes = (
            self._base_attributes.copy() if self._base_attributes else {}
        )
        self.tracer_provider = self._tracer_provider
        self.instrumentors = list(self._instrumentors) if self._instrumentors else []

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
        cls._instrumentors = ()
        cls._disable_sending = False
        cls._flush_on_exit = True
        cls._span_exclude_rules = []
        cls._ignore_global_tracer_provider_override_warning = False
        cls._skip_open_telemetry_setup = False
        cls._tracer_provider = None
        cls._rest_api_client = None
        cls._registered_instrumentors.clear()

    @classmethod
    def reset_for_testing(cls) -> None:
        """Reset the singleton instance for testing purposes."""
        cls._reset_instance()

    @classmethod
    def get_singleton_instance(cls) -> Optional["Client"]:
        """Get the singleton instance for testing purposes."""
        return cls._instance

    @property
    def is_initialized(self) -> bool:
        """Check if this instance has been initialized for testing purposes."""
        return hasattr(self, "_initialized") and self._initialized

    @property
    def debug(self) -> bool:
        """Get the debug flag for the client."""
        return Client._debug

    @debug.setter
    def debug(self, value: bool) -> None:
        """Set the debug flag for the client."""
        Client._debug = value

    @property
    def endpoint_url(self) -> str:
        """Get the endpoint URL for the client."""
        return Client._endpoint_url

    @property
    def flush_on_exit(self) -> bool:
        """Get the flush on exit flag for the client."""
        return Client._flush_on_exit

    @property
    def api_key(self) -> str:
        """Get the API key for the client."""
        return Client._api_key

    @api_key.setter
    def api_key(self, value: str) -> None:
        """Set the API key for the client."""
        if value == Client._api_key:
            return

        previous_key = Client._api_key
        Client._api_key = value

        if previous_key and not Client._skip_open_telemetry_setup:
            # Shut down any existing tracer provider, as API key change requires re-initialization.
            self.__shutdown_tracer_provider()

            # HACK: set global tracer provider to a proxy tracer provider back
            opentelemetry.trace._TRACER_PROVIDER = None  # type: ignore
            opentelemetry.trace._TRACER_PROVIDER_SET_ONCE = Once()  # type: ignore

        # Ensure provider/exporter exist after setting the key
        if (
            value
            and not Client._disable_sending
            and not Client._skip_open_telemetry_setup
        ):
            self.__setup_tracer_provider()

        if value:
            self._setup_rest_api_client()

    @property
    def disable_sending(self) -> bool:
        """Get whether sending is disabled."""
        return Client._disable_sending

    @property
    def rest_api_client(self) -> LangWatchApiClient:
        """Get the REST API client for the client."""
        if Client._rest_api_client is None:
            raise RuntimeError(
                "REST API client not initialized. Call _setup_rest_api_client() first."
            )
        return Client._rest_api_client

    @property
    def skip_open_telemetry_setup(self) -> bool:
        """Get whether OpenTelemetry setup is skipped."""
        return Client._skip_open_telemetry_setup

    @disable_sending.setter
    def disable_sending(self, value: bool) -> None:
        """Set whether sending is disabled. Spans are still created; the exporter conditionally drops them."""
        if Client._disable_sending == value:
            return

        # force flush the tracer provider before changing the disable_sending flag
        if Client._tracer_provider and not Client._skip_open_telemetry_setup:
            Client._tracer_provider.force_flush()

        Client._disable_sending = value

    def __shutdown_tracer_provider(self) -> None:
        """Shuts down the current tracer provider, including flushing."""
        if self._tracer_provider:
            if self._flush_on_exit:
                try:
                    # Unregister the atexit hook if it was registered.
                    atexit.unregister(self._tracer_provider.force_flush)
                except ValueError:
                    pass  # Handler was never registered or already unregistered.

            force_flush = getattr(self._tracer_provider, "force_flush", None)
            if callable(force_flush):
                if self._debug:
                    logger.debug("Forcing flush of tracer provider before shutdown.")
                force_flush()

            if Client._debug:
                logger.debug("Shutting down tracer provider.")
            if Client._tracer_provider is not None:
                Client._tracer_provider.shutdown()
            Client._tracer_provider = None

    def __setup_tracer_provider(self) -> None:
        """Sets up the tracer provider if not already active."""
        if Client._skip_open_telemetry_setup:
            if Client._debug:
                logger.debug("Skipping tracer provider setup as requested.")
            return

        if not Client._tracer_provider:
            if Client._debug:
                logger.debug("Setting up new tracer provider.")
            Client._tracer_provider = self.__ensure_otel_setup()

            return

        if Client._debug:
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

            if isinstance(global_provider, TracerProvider):
                if not self._ignore_global_tracer_provider_override_warning:
                    logger.warning(
                        "An existing global tracer provider was found. Attaching LangWatch exporter to the existing provider. Set `ignore_global_tracer_provider_override_warning=True` to suppress this warning."
                    )
                self.__set_langwatch_exporter(global_provider)
                return global_provider
            else:
                if Client._debug:
                    logger.debug(
                        "Global tracer provider is not an SDK TracerProvider; creating/using a new provider for LangWatch exporter."
                    )
                self.__set_langwatch_exporter(settable_tracer_provider)
                return settable_tracer_provider

        except Exception as e:
            raise RuntimeError(
                f"Failed to setup OpenTelemetry tracer provider: {e}"
            ) from e

    def __create_new_tracer_provider(self) -> TracerProvider:
        try:
            resource = Resource.create(Client._base_attributes)
            sampler = ALWAYS_OFF if Client._disable_sending else TraceIdRatioBased(1.0)
            provider = TracerProvider(resource=resource, sampler=sampler)

            # Only set up LangWatch exporter if sending is not disabled
            if not Client._disable_sending:
                self.__set_langwatch_exporter(provider)

            if Client._flush_on_exit:
                logger.info(
                    "Registering atexit handler to flush tracer provider on exit"
                )
                atexit.register(provider.force_flush)

            if Client._debug:
                logger.info(
                    "Successfully configured tracer provider with OTLP exporter"
                )

            return provider
        except Exception as e:
            raise RuntimeError(
                f"Failed to create and configure tracer provider: {e}"
            ) from e

    def __set_langwatch_exporter(self, provider: TracerProvider) -> None:
        if not Client._api_key:
            raise ValueError("LangWatch API key is required but not provided")

        headers = {
            "Authorization": f"Bearer {Client._api_key}",
            "X-LangWatch-SDK-Version": str(__version__),
        }

        if Client._debug:
            logger.info(
                f"Configuring OTLP exporter with endpoint: {Client._endpoint_url}/api/otel/v1/traces"
            )

        otlp_exporter = OTLPSpanExporter(
            endpoint=f"{Client._endpoint_url}/api/otel/v1/traces",
            headers=headers,
            timeout=int(os.getenv("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", 30)),
        )

        # Wrap the exporter with conditional logic
        conditional_exporter = ConditionalSpanExporter(
            wrapped_exporter=otlp_exporter,
        )

        processor = FilterableBatchSpanProcessor(
            span_exporter=conditional_exporter,
            exclude_rules=Client._span_exclude_rules,
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
        Client._rest_api_client = LangWatchApiClient(
            base_url=Client._endpoint_url,
            headers={"X-Auth-Token": Client._api_key},
            raise_on_unexpected_status=True,
        )

        return Client._rest_api_client


class ConditionalSpanExporter(SpanExporter):
    def __init__(self, wrapped_exporter: SpanExporter):
        self.wrapped_exporter: SpanExporter = wrapped_exporter

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

    def force_flush(self, timeout_millis: Optional[int] = 30000) -> bool:
        client = get_instance()
        if client and client.disable_sending:
            return True  # Nothing to flush
        # Handle None case by providing default value
        actual_timeout = timeout_millis if timeout_millis is not None else 30000
        return self.wrapped_exporter.force_flush(actual_timeout)
