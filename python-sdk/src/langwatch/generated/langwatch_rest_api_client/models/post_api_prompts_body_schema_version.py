from enum import Enum


class PostApiPromptsBodySchemaVersion(str, Enum):
    VALUE_0 = "1.0"

    def __str__(self) -> str:
        return str(self.value)
