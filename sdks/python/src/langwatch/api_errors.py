"""
Typed errors for the LangWatch REST surfaces.

Mirrors the TypeScript SDK, which raises a typed error carrying the platform's
own ``code`` whenever a failure was NAMED, so a caller branches on a stable
discriminant instead of matching on prose::

    LangWatchApiError (base: .code, .status, .operation, .body)
    +-- LangWatchApiValidationError    (400, 422)
    +-- LangWatchApiAuthenticationError(401, 403)
    +-- LangWatchApiPlanLimitError     (402)
    +-- LangWatchApiNotFoundError      (404)
    +-- LangWatchApiConflictError      (409)
    +-- LangWatchApiServerError        (5xx)

The status-derived subclasses are a convenience for the common case. ``code``
is the contract: two 409s can mean different things, and only the code tells
them apart::

    try:
        langwatch.gateway_budgets.create(..., idempotency_key=key)
    except LangWatchApiError as error:
        if error.code == "idempotency_error":
            ...  # same key, different body
        raise

Local misuse stays a builtin: a missing argument or an empty secret raises
``TypeError`` / ``ValueError`` as it always did. Those never crossed the wire,
so they carry no code and are not API errors.
"""

from typing import Any, Optional

__all__ = [
    "LangWatchApiError",
    "LangWatchApiValidationError",
    "LangWatchApiAuthenticationError",
    "LangWatchApiPlanLimitError",
    "LangWatchApiNotFoundError",
    "LangWatchApiConflictError",
    "LangWatchApiServerError",
]


class LangWatchApiError(Exception):
    """A request the platform refused.

    :ivar code: The platform's stable discriminant, e.g. ``idempotency_error``
        or ``validation_error``. ``None`` when the response carried no named
        code, which is what an unnamed 5xx or a proxy's HTML looks like.
    :ivar status: The HTTP status.
    :ivar operation: What was being attempted, e.g. ``create budget``.
    :ivar body: The parsed error payload, verbatim, for the fields this class
        does not promote (``meta``, ``tips``, ``trace_id``).
    """

    def __init__(
        self,
        message: str,
        *,
        status: int,
        operation: str = "",
        code: Optional[str] = None,
        body: Any = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.operation = operation
        self.code = code
        self.body = body


class LangWatchApiValidationError(LangWatchApiError):
    """The request was malformed or failed validation (400, 422)."""


class LangWatchApiAuthenticationError(LangWatchApiError):
    """The credential was missing, wrong, or not allowed here (401, 403)."""


class LangWatchApiPlanLimitError(LangWatchApiError):
    """The plan does not include this surface, or a limit was reached (402)."""


class LangWatchApiNotFoundError(LangWatchApiError):
    """No such resource, or none this credential may see (404)."""


class LangWatchApiConflictError(LangWatchApiError):
    """The request collided with existing state (409).

    An idempotency key reused with a different body arrives here, as
    ``code == "idempotency_error"``.
    """


class LangWatchApiServerError(LangWatchApiError):
    """The platform fell over (5xx). Nothing about the request was refused,
    so a retry is reasonable where the call is safe to repeat."""


def error_for_status(
    message: str,
    *,
    status: int,
    operation: str = "",
    code: Optional[str] = None,
    body: Any = None,
) -> LangWatchApiError:
    """Build the most specific error class the status justifies."""
    by_status = {
        400: LangWatchApiValidationError,
        422: LangWatchApiValidationError,
        401: LangWatchApiAuthenticationError,
        403: LangWatchApiAuthenticationError,
        402: LangWatchApiPlanLimitError,
        404: LangWatchApiNotFoundError,
        409: LangWatchApiConflictError,
    }
    cls = by_status.get(status)
    if cls is None:
        cls = LangWatchApiServerError if status >= 500 else LangWatchApiError
    return cls(message, status=status, operation=operation, code=code, body=body)
