from enum import Enum


class PostLangyControlFramesBodyFramesItemType4Decision(str, Enum):
    ALLOW_ONCE = "allow_once"
    ALLOW_PATTERN = "allow_pattern"
    DENY = "deny"

    def __str__(self) -> str:
        return str(self.value)
