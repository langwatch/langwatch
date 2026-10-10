from enum import Enum


class LangyLocalWorkspaceResponse200CodeAccessPreferenceType0(str, Enum):
    GITHUB = "github"

    def __str__(self) -> str:
        return str(self.value)
