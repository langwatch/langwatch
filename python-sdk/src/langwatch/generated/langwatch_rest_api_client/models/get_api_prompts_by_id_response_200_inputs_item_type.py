from enum import Enum


class GetApiPromptsByIdResponse200InputsItemType(str, Enum):
    BOOL = "bool"
    DICT = "dict"
    FLOAT = "float"
    IMAGE = "image"
    LISTBOOL = "list[bool]"
    LISTFLOAT = "list[float]"
    LISTINT = "list[int]"
    LISTSTR = "list[str]"
    STR = "str"

    def __str__(self) -> str:
        return str(self.value)
