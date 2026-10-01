from enum import Enum


class CreateAgentBodyType2ConfigParametersItemType(str, Enum):
    BOOL = "bool"
    CHAT_MESSAGES = "chat_messages"
    CODE = "code"
    DATASET = "dataset"
    DICT = "dict"
    FLOAT = "float"
    IMAGE = "image"
    INT = "int"
    JSON_SCHEMA = "json_schema"
    LIST = "list"
    LISTBOOL = "list[bool]"
    LISTFLOAT = "list[float]"
    LISTINT = "list[int]"
    LISTSTR = "list[str]"
    LLM = "llm"
    PROMPTING_TECHNIQUE = "prompting_technique"
    SIGNATURE = "signature"
    STR = "str"

    def __str__(self) -> str:
        return str(self.value)
