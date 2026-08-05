"""
Custom error hierarchy for dataset operations.

Mirrors the TypeScript SDK's error hierarchy::

    DatasetError (base)
    +-- DatasetApiError (HTTP failures: status_code, operation, original_error)
    +-- DatasetNotFoundError (404)
    +-- DatasetPlanLimitError (403 from resourceLimitMiddleware)

Client-side validation errors (empty name, empty entries, missing files) remain
as ValueError / FileNotFoundError -- they are NOT API errors.
"""


class DatasetError(Exception):
    """Base exception for all dataset operations."""

    pass


class DatasetApiError(DatasetError):
    """Raised for HTTP errors from the dataset API."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int,
        operation: str,
        original_error: Exception | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.operation = operation
        self.original_error = original_error


class DatasetNotFoundError(DatasetError):
    """Raised when a dataset or record is not found (404)."""

    def __init__(self, message: str = "Dataset not found") -> None:
        super().__init__(message)


class DatasetPlanLimitError(DatasetError):
    """Raised when a plan limit is reached (403 from resourceLimitMiddleware).

    The server sends limitType, current, max, and upgrade URL.
    """

    def __init__(
        self,
        message: str,
        *,
        limit_type: str | None = None,
        current: int | None = None,
        max: int | None = None,
        upgrade_url: str | None = None,
    ) -> None:
        super().__init__(message)
        self.limit_type = limit_type
        self.current = current
        self.max = max
        self.upgrade_url = upgrade_url
