"""Utility module for handling LangWatch initialization."""

import logging
import sys
from typing import Optional, Sequence
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry import trace

from langwatch.state import get_instance, set_instance
from langwatch.client import Client
from langwatch.types import BaseAttributes
from langwatch.typings import Instrumentor

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
    instrumentors: Optional[Sequence[Instrumentor]] = None,
    debug: bool = False,
) -> Client:
    """Initialize the LangWatch client."""
    _setup_logging(debug)
    
    if debug:
        logger.info("Setting up LangWatch client...")
        
    client = Client(
        api_key=api_key,
        endpoint_url=endpoint_url,
        base_attributes=base_attributes,
        tracer_provider=tracer_provider,
        instrumentors=instrumentors,
        debug=debug,
    )
    
    if debug:
        logger.info("LangWatch client setup complete")
        
    set_instance(client)
    return client

def ensure_setup() -> None:
    """Ensure LangWatch client is setup.
    
    If no client is setup, this will create a default client using environment variables.
    Validates that we have a working tracer provider to prevent silent failures.
    """
    client = get_instance()
    if client is None:
        logger.debug("No LangWatch client found, creating default client")
        client = setup(debug=True)  # Enable debug logging for auto-created clients
    
    # Verify we have a valid tracer provider
    tracer_provider = trace.get_tracer_provider()
    if tracer_provider is None:
        logger.warning("No tracer provider found, creating new one")
        client = setup(debug=True)
    elif isinstance(tracer_provider, trace.ProxyTracerProvider):
        logger.debug("Found proxy tracer provider, will be replaced with real provider")
        # This is fine - the client will replace it with a real provider
