from enum import Enum


class PatchApiWebhooksV1EndpointsByIdResponse200DataType0Status(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"

    def __str__(self) -> str:
        return str(self.value)
