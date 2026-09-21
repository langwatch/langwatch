from enum import Enum


class PatchApiGatewayV1VirtualKeysByIdBodyConfigCacheMode(str, Enum):
    DISABLE = "disable"
    FORCE = "force"
    RESPECT = "respect"

    def __str__(self) -> str:
        return str(self.value)
