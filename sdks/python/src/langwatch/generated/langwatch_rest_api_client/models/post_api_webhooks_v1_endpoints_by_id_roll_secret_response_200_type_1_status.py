from enum import Enum


class PostApiWebhooksV1EndpointsByIdRollSecretResponse200Type1Status(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"

    def __str__(self) -> str:
        return str(self.value)
