from enum import Enum


class PostLangyControlFramesBodyFramesItemType1Type(str, Enum):
    ACK = "ack"

    def __str__(self) -> str:
        return str(self.value)
