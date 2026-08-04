from enum import Enum


class PutApiModelProvidersByProviderBodyCustomEmbeddingsModelsType0ItemMultimodalInputsItem(str, Enum):
    AUDIO = "audio"
    FILE = "file"
    IMAGE = "image"

    def __str__(self) -> str:
        return str(self.value)
