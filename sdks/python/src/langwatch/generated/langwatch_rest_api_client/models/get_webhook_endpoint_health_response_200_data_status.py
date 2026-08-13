from enum import Enum


class GetWebhookEndpointHealthResponse200DataStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"

    def __str__(self) -> str:
        return str(self.value)
