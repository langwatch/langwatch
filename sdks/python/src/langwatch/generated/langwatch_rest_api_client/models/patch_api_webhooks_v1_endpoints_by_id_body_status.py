from enum import Enum


class PatchApiWebhooksV1EndpointsByIdBodyStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"

    def __str__(self) -> str:
        return str(self.value)
