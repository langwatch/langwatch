from enum import Enum


class PostApiGatewayV1CacheRulesResponse201CacheRuleActionMode(str, Enum):
    DISABLE = "disable"
    FORCE = "force"
    RESPECT = "respect"

    def __str__(self) -> str:
        return str(self.value)
