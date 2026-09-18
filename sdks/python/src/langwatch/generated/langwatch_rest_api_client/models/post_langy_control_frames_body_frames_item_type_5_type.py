from enum import Enum


class PostLangyControlFramesBodyFramesItemType5Type(str, Enum):
    DEREGISTER = "deregister"

    def __str__(self) -> str:
        return str(self.value)
