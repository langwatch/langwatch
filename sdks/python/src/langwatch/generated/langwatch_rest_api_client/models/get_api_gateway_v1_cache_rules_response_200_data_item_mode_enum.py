from enum import Enum


class GetApiGatewayV1CacheRulesResponse200DataItemModeEnum(str, Enum):
    DISABLE = "disable"
    FORCE = "force"
    RESPECT = "respect"

    def __str__(self) -> str:
        return str(self.value)
