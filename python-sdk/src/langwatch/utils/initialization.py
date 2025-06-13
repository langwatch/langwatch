"""Utility module for handling LangWatch initialization."""

import logging
import sys
from typing import List, Optional, Sequence
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry import trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor

from langwatch.state import get_instance, set_instance
from langwatch.client import Client
from langwatch.domain import BaseAttributes, SpanProcessingExcludeRule

logger = logging.getLogger(__name__)

def _setup_logging(debug: bool = False) -> None:
    """Configure logging for LangWatch."""
    root_logger = logging.getLogger("langwatch")
    if not root_logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        handler.setFormatter(formatter)
        root_logger.addHandler(handler)

    if debug:
        root_logger.setLevel(logging.DEBUG)
    else:
        root_logger.setLevel(logging.INFO)

def setup(
    api_key: Optional[str] = None,
    endpoint_url: Optional[str] = None,
    base_attributes: Optional[BaseAttributes] = None,
    tracer_provider: Optional[TracerProvider] = None,
    instrumentors: Optional[Sequence[BaseInstrumentor]] = None,
    span_exclude_rules: Optional[List[SpanProcessingExcludeRule]] = [],
    debug: bool = False,
) -> Client:
    """
    Initialize the LangWatch client.

    Args:
        api_key: The API key for the LangWatch client.
        endpoint_url: The endpoint URL for the LangWatch client.
        base_attributes: The base attributes for the LangWatch client.
        tracer_provider: The tracer provider for the LangWatch client.
        instrumentors: The instrumentors for the LangWatch client.
        span_exclude_rules: Optional. A list of rules that will be applied to spans processed by the exporter.
        debug: Whether to enable debug logging for the LangWatch client.

    Returns:
        The LangWatch client.
    """
    _setup_logging(debug)

    if debug:
        logger.info("Setting up LangWatch client...")

    # TODO: get rid of this
    changed_api_key = False
    if get_instance() is not None and api_key != get_instance().api_key:
        logger.warning("LangWatch was already setup before, and now it is being setup with a new API key. This will nuke the previous tracing providers. This is not recommended.")
        # Set the new API key on the current client to make sure, triggering a nuke of the previous tracing providers too
        get_instance().api_key = api_key
        changed_api_key = True

    client = Client(
        api_key=api_key,
        endpoint_url=endpoint_url,
        base_attributes=base_attributes,
        tracer_provider=tracer_provider,
        instrumentors=instrumentors,
        debug=debug,
        span_exclude_rules=span_exclude_rules,
        ignore_global_tracer_provider_override_warning=changed_api_key,
    )

    if debug:
        logger.info("LangWatch client setup complete")

    set_instance(client)
    return client

def ensure_setup(api_key: Optional[str] = None) -> None:
    """Ensure LangWatch client is setup.

    If no client is setup, this will create a default client using environment variables.
    Validates that we have a working tracer provider to prevent silent failures.
    """
    client = get_instance()
    if client is None:
        logger.debug("No LangWatch client found, creating default client")
        client = setup(debug=True, api_key=api_key)  # Enable debug logging for auto-created clients

    # Verify we have a valid tracer provider
    tracer_provider = trace.get_tracer_provider()
    if tracer_provider is None: # type: ignore
        logger.warning("No tracer provider found, creating new one")
        client = setup(debug=True, api_key=api_key)
    elif isinstance(tracer_provider, trace.ProxyTracerProvider):
        logger.debug("Found proxy tracer provider, will be replaced with real provider")
        # This is fine - the client will replace it with a real provider
