from enum import Enum


class PatchApiGatewayV1VirtualKeysByIdBodyConfigFallbackOnItem(str, Enum):
    CIRCUIT_BREAKER = "circuit_breaker"
    NETWORK_ERROR = "network_error"
    RATE_LIMIT_EXCEEDED = "rate_limit_exceeded"
    TIMEOUT = "timeout"
    VALUE_0 = "5xx"

    def __str__(self) -> str:
        return str(self.value)
