"""
Structured logger for langwatch_nlp - uses JSON in production, pretty-print in development.

Similar to langwatch/src/utils/logger/index.ts (pino).
"""

import logging
import os
import sys
from contextvars import ContextVar
from typing import Any, Optional

import structlog
from structlog.typing import EventDict, WrappedLogger

# Context variable for request-scoped data (like project_id)
# Using None as default to avoid sharing a mutable dict across contexts
_log_context: ContextVar[Optional[dict[str, Any]]] = ContextVar("log_context", default=None)


def get_log_context() -> dict[str, Any]:
    """Get the current log context."""
    current = _log_context.get()
    return (current or {}).copy()


def set_log_context(**kwargs: Any) -> None:
    """Set values in the log context for the current async context."""
    current = _log_context.get() or {}
    updated = current.copy()
    updated.update(kwargs)
    _log_context.set(updated)


def clear_log_context() -> None:
    """Clear the log context."""
    _log_context.set(None)


def _add_context_processor(
    logger: WrappedLogger, method_name: str, event_dict: EventDict
) -> EventDict:
    """Add context variables to log events."""
    context = get_log_context()
    # Insert context at the beginning so it appears before the message details
    for key, value in context.items():
        if key not in event_dict:
            event_dict[key] = value
    return event_dict


def _add_log_level_uppercase(
    logger: WrappedLogger, method_name: str, event_dict: EventDict
) -> EventDict:
    """Convert log level to uppercase (matching TypeScript logger)."""
    if "level" in event_dict:
        event_dict["level"] = event_dict["level"].upper()
    return event_dict


def _snake_to_camel(name: str) -> str:
    """Convert snake_case to camelCase."""
    components = name.split("_")
    return components[0] + "".join(x.title() for x in components[1:])


def _convert_keys_to_camel_case(
    logger: WrappedLogger, method_name: str, event_dict: EventDict
) -> EventDict:
    """Convert all snake_case keys to camelCase for JSON output (matching JS conventions)."""
    # Keys to keep as-is (standard structlog keys)
    keep_as_is = {"event", "level", "logger", "timestamp"}

    new_dict: EventDict = {}
    for key, value in event_dict.items():
        if key in keep_as_is or "_" not in key:
            new_dict[key] = value
        else:
            new_dict[_snake_to_camel(key)] = value
    return new_dict


def _configure_structlog() -> None:
    """Configure structlog based on environment."""
    is_test = os.environ.get("NODE_ENV") == "test" or os.environ.get("PYTEST_CURRENT_TEST")
    environment = os.environ.get("ENVIRONMENT", "").lower()
    is_deployed = environment in ("production", "staging", "development")
    is_prod = os.environ.get("NODE_ENV") == "production" or is_deployed
    log_level_str = os.environ.get("LOG_LEVEL", "INFO" if not is_test else "ERROR")
    log_level = getattr(logging, log_level_str.upper(), logging.INFO)

    def add_logger_name(
        logger: WrappedLogger, method_name: str, event_dict: EventDict
    ) -> EventDict:
        """Add logger name to the event dict."""
        # The logger name is passed as the first argument to get_logger()
        record = event_dict.get("_record")
        if record and hasattr(record, "name"):
            event_dict["logger"] = record.name
        return event_dict

    # Shared processors for all environments
    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        _add_context_processor,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
        structlog.processors.CallsiteParameterAdder(),
    ]

    if is_prod:
        # Production: JSON to stdout with camelCase keys
        structlog.configure(
            processors=[
                *shared_processors,
                _add_log_level_uppercase,
                _convert_keys_to_camel_case,
                structlog.processors.format_exc_info,
                structlog.processors.JSONRenderer(),
            ],
            wrapper_class=structlog.stdlib.BoundLogger,
            context_class=dict,
            logger_factory=structlog.stdlib.LoggerFactory(),
            cache_logger_on_first_use=True,
        )
    else:
        # Development/Test: Pretty console output
        structlog.configure(
            processors=[
                *shared_processors,
                structlog.dev.ConsoleRenderer(colors=not is_test),
            ],
            wrapper_class=structlog.stdlib.BoundLogger,
            context_class=dict,
            logger_factory=structlog.stdlib.LoggerFactory(),
            cache_logger_on_first_use=True,
        )

    # Also configure standard library logging to use structlog
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )


# Configure structlog on module import
_configure_structlog()


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """
    Get a structured logger instance.

    Usage:
        logger = get_logger("topic_clustering.batch")
        logger.info("Starting batch clustering", trace_count=100)

        # With context binding (for project_id, etc.)
        set_log_context(project_id="proj_123")
        logger.info("Processing")  # Will include project_id automatically
    """
    return structlog.get_logger(name)


# Type alias for backwards compatibility
Logger = structlog.stdlib.BoundLogger
