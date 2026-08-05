from enum import Enum


class PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0OnBreach(str, Enum):
    BLOCK = "block"
    WARN = "warn"

    def __str__(self) -> str:
        return str(self.value)
