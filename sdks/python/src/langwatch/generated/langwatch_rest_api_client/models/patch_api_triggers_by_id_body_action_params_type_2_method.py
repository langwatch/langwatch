from enum import Enum


class PatchApiTriggersByIdBodyActionParamsType2Method(str, Enum):
    PATCH = "PATCH"
    POST = "POST"
    PUT = "PUT"

    def __str__(self) -> str:
        return str(self.value)
