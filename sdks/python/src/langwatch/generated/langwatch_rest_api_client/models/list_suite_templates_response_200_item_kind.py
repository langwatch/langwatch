from enum import Enum


class ListSuiteTemplatesResponse200ItemKind(str, Enum):
    ARCHETYPE = "archetype"
    RED_TEAM_PACK = "red_team_pack"

    def __str__(self) -> str:
        return str(self.value)
