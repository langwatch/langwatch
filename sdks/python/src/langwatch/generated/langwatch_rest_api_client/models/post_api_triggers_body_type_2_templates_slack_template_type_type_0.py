from enum import Enum


class PostApiTriggersBodyType2TemplatesSlackTemplateTypeType0(str, Enum):
    BLOCK_KIT = "block_kit"
    STRING = "string"

    def __str__(self) -> str:
        return str(self.value)
