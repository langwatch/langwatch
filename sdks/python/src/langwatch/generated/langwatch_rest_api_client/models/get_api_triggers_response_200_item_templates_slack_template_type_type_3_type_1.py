from enum import Enum


class GetApiTriggersResponse200ItemTemplatesSlackTemplateTypeType3Type1(str, Enum):
    BLOCK_KIT = "block_kit"
    STRING = "string"

    def __str__(self) -> str:
        return str(self.value)
