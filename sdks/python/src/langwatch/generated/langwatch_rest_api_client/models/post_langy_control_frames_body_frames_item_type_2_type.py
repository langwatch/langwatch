from enum import Enum


class PostLangyControlFramesBodyFramesItemType2Type(str, Enum):
    RESULT = "result"

    def __str__(self) -> str:
        return str(self.value)
