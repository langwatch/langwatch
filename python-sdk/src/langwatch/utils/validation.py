"""Runtime parameter validation helpers for the LangWatch SDK.

These utilities emit warnings (never raise exceptions) so that SDK monitoring
cannot break a user's application. On bad input they return ``None``, which
prevents malformed data from reaching the LangWatch HTTP endpoint.
"""

import warnings
from typing import Any, List, Optional


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
        warnings.warn(
            f"[langwatch] Parameter '{param_name}' expected a list but received "
            f"{type(value).__name__!r}. "
            f"Example of correct usage: {param_name}={example}. "
            "The parameter has been ignored to prevent sending malformed data.",
            UserWarning,
            stacklevel=4,
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
        warnings.warn(
            f"[langwatch] Parameter 'metadata' expected a dict but received "
            f"{type(value).__name__!r}. "
            'Example of correct usage: metadata={"user_id": "u-123", "labels": ["production"]}. '
            "The parameter has been ignored to prevent sending malformed data.",
            UserWarning,
            stacklevel=4,
        )
        return None
    labels = value.get("labels")
    if labels is not None and not isinstance(labels, list):
        warnings.warn(
            f"[langwatch] metadata['labels'] expected a list but received "
            f"{type(labels).__name__!r}. "
            'Example of correct usage: metadata={"labels": ["production", "v2"]}. '
            "The 'labels' field has been removed to prevent sending malformed data.",
            UserWarning,
            stacklevel=4,
        )
        value = {k: v for k, v in value.items() if k != "labels"}
    return value
