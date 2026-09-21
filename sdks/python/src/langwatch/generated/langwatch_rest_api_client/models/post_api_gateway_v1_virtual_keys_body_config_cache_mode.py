from enum import Enum


class PostApiGatewayV1VirtualKeysBodyConfigCacheMode(str, Enum):
    DISABLE = "disable"
    FORCE = "force"
    RESPECT = "respect"

    def __str__(self) -> str:
        return str(self.value)
