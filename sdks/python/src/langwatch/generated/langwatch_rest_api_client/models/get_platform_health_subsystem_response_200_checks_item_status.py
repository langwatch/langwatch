from enum import Enum


class GetPlatformHealthSubsystemResponse200ChecksItemStatus(str, Enum):
    HEALTHY = "healthy"
    NOT_CONFIGURED = "not_configured"
    UNHEALTHY = "unhealthy"

    def __str__(self) -> str:
        return str(self.value)
