from enum import Enum


class PostApiTriggersBodyType4TemplatesSlackTemplateTypeType2Type1(str, Enum):
    BLOCK_KIT = "block_kit"
    STRING = "string"

    def __str__(self) -> str:
        return str(self.value)
