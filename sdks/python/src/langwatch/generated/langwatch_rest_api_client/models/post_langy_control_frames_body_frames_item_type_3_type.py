from enum import Enum


class PostLangyControlFramesBodyFramesItemType3Type(str, Enum):
    PERMISSION_REQUIRED = "permission_required"

    def __str__(self) -> str:
        return str(self.value)
