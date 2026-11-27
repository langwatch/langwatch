from enum import Enum


class ListSuiteTemplatesResponse200ItemScenariosItemAttackStrategy(str, Enum):
    CRESCENDO = "crescendo"
    GOAT = "goat"

    def __str__(self) -> str:
        return str(self.value)
