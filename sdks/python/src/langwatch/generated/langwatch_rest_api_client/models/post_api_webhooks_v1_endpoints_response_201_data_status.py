from enum import Enum


class PostApiWebhooksV1EndpointsResponse201DataStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"

    def __str__(self) -> str:
        return str(self.value)
