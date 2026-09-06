from enum import Enum


class PutApiModelProvidersByProviderBodyCustomModelsType0ItemMode(str, Enum):
    CHAT = "chat"
    EMBEDDING = "embedding"

    def __str__(self) -> str:
        return str(self.value)
