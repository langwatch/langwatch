from enum import Enum


class PollLangyControlSessionResponse200FramesItemType4Decision(str, Enum):
    ALLOW_ONCE = "allow_once"
    ALLOW_PATTERN = "allow_pattern"
    DENY = "deny"
    EXPIRED = "expired"

    def __str__(self) -> str:
        return str(self.value)
