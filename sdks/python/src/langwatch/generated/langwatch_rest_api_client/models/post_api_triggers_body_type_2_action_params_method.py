from enum import Enum


class PostApiTriggersBodyType2ActionParamsMethod(str, Enum):
    PATCH = "PATCH"
    POST = "POST"
    PUT = "PUT"

    def __str__(self) -> str:
        return str(self.value)
