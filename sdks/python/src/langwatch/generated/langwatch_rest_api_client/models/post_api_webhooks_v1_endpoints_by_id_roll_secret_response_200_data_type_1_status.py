from enum import Enum


class PostApiWebhooksV1EndpointsByIdRollSecretResponse200DataType1Status(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"

    def __str__(self) -> str:
        return str(self.value)
