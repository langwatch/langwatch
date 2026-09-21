from enum import Enum


class PostApiGatewayV1VirtualKeysByIdRotateResponse200VirtualKeyRoutingMode(str, Enum):
    FALLBACK_ALL = "fallback_all"
    NONE = "none"
    POLICY = "policy"

    def __str__(self) -> str:
        return str(self.value)
