from enum import Enum


class PostApiScenariosBodyKind(str, Enum):
    RED_TEAM = "red_team"
    STANDARD = "standard"

    def __str__(self) -> str:
        return str(self.value)
