from enum import Enum


class UpdateWebhookEndpointBodyStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"

    def __str__(self) -> str:
        return str(self.value)
