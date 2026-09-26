from enum import Enum


class PostApiWebhooksV1EndpointsResponse201Type1Status(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"

    def __str__(self) -> str:
        return str(self.value)
