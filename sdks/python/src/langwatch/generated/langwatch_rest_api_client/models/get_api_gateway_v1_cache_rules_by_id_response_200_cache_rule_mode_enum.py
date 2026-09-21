from enum import Enum


class GetApiGatewayV1CacheRulesByIdResponse200CacheRuleModeEnum(str, Enum):
    DISABLE = "disable"
    FORCE = "force"
    RESPECT = "respect"

    def __str__(self) -> str:
        return str(self.value)
