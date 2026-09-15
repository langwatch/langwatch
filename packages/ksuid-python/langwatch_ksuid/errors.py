"""Custom exception classes for the KSUID library."""


class ValidationError(ValueError):
    """Error thrown when validation fails."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.name = "ValidationError"


class Base62Error(ValueError):
    """Error thrown when base62 encoding/decoding fails."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.name = "Base62Error"
