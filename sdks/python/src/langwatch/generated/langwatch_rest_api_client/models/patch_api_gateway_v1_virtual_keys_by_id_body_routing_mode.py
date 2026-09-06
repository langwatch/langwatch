from enum import Enum


class PatchApiGatewayV1VirtualKeysByIdBodyRoutingMode(str, Enum):
    FALLBACK_ALL = "fallback_all"
    NONE = "none"
    POLICY = "policy"

    def __str__(self) -> str:
        return str(self.value)
