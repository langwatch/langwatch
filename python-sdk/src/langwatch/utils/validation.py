"""Runtime parameter validation helpers for the LangWatch SDK.

These utilities emit warnings (never raise exceptions) so that SDK monitoring
cannot break a user's application. On bad input they return ``None``, which
prevents malformed data from reaching the LangWatch HTTP endpoint.
"""

import sys
import warnings
from typing import Any, List, Optional


def _in_sdk(frame) -> bool:
    """Check whether *frame* belongs to the ``langwatch`` package."""
    module = frame.f_globals.get("__name__", "")
    return module == "langwatch" or module.startswith("langwatch.")


def _warn(message: str) -> None:
    """Emit a UserWarning attributed to the first frame outside the SDK.

    A fixed ``stacklevel`` cannot point at the user's code for every entry
    point (``langwatch.trace()``, ``LangWatchTrace()``, ``.update()`` each add
    a different number of SDK frames), so walk the stack until we leave the
    ``langwatch`` package.
    """
    frame = sys._getframe(1)
    stacklevel = 2
    while frame.f_back is not None and _in_sdk(frame):
        frame = frame.f_back
        stacklevel += 1
    warnings.warn(message, UserWarning, stacklevel=stacklevel)


def validate_list_param(
    param_name: str,
    value: Any,
    example: str = "[...]",
) -> Optional[List[Any]]:
    """Warn and return ``None`` if *value* is not a list.

    Args:
        param_name: Name of the parameter shown in the warning message.
        value: The value passed by the caller.
        example: An illustrative correct usage shown in the warning.

    Returns:
        The original *value* when it is already a list, otherwise ``None``.
    """
    if value is None:
        return None
    if not isinstance(value, list):
        _warn(
            f"[langwatch] Parameter '{param_name}' expected a list but received "
            f"{type(value).__name__!r}. "
            f"Example of correct usage: {param_name}={example}. "
            "The parameter has been ignored to prevent sending malformed data."
        )
        return None
    return value


def validate_metadata(value: Any) -> Optional[dict]:
    """Warn and return ``None`` if *value* is not a dict.

    Args:
        value: The value passed for the ``metadata`` parameter.

    Returns:
        The original *value* when it is already a dict, otherwise ``None``.
    """
    if value is None:
        return None
    if not isinstance(value, dict):
        _warn(
            f"[langwatch] Parameter 'metadata' expected a dict but received "
            f"{type(value).__name__!r}. "
            'Example of correct usage: metadata={"user_id": "u-123", "labels": ["production"]}. '
            "The parameter has been ignored to prevent sending malformed data."
        )
        return None
    labels = value.get("labels")
    if labels is not None and not isinstance(labels, list):
        _warn(
            f"[langwatch] metadata['labels'] expected a list but received "
            f"{type(labels).__name__!r}. "
            'Example of correct usage: metadata={"labels": ["production", "v2"]}. '
            "The 'labels' field has been ignored to prevent sending malformed data."
        )
        value = {k: v for k, v in value.items() if k != "labels"}
    return value
