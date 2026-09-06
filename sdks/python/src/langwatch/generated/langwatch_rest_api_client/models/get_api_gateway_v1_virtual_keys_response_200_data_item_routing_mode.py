from enum import Enum


class GetApiGatewayV1VirtualKeysResponse200DataItemRoutingMode(str, Enum):
    FALLBACK_ALL = "fallback_all"
    NONE = "none"
    POLICY = "policy"

    def __str__(self) -> str:
        return str(self.value)
