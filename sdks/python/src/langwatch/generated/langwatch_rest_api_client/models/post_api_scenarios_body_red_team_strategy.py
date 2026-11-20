from enum import Enum


class PostApiScenariosBodyRedTeamStrategy(str, Enum):
    CRESCENDO = "crescendo"
    GOAT = "goat"

    def __str__(self) -> str:
        return str(self.value)
