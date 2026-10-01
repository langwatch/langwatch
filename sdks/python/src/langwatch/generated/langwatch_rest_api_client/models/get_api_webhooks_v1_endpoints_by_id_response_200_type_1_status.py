from enum import Enum


class GetApiWebhooksV1EndpointsByIdResponse200Type1Status(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"

    def __str__(self) -> str:
        return str(self.value)
