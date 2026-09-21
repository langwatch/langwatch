from enum import Enum


class PostApiGatewayV1CacheRulesBodyActionMode(str, Enum):
    DISABLE = "disable"
    FORCE = "force"
    RESPECT = "respect"

    def __str__(self) -> str:
        return str(self.value)
