from enum import Enum


class PostApiPromptsByIdSyncResponse200PromptDemonstrationsInlineColumnTypesItemType(str, Enum):
    ANNOTATIONS = "annotations"
    BOOLEAN = "boolean"
    CHAT_MESSAGES = "chat_messages"
    DATE = "date"
    EVALUATIONS = "evaluations"
    FILE = "file"
    IMAGE = "image"
    JSON = "json"
    LIST = "list"
    NUMBER = "number"
    RAG_CONTEXTS = "rag_contexts"
    SPANS = "spans"
    STRING = "string"

    def __str__(self) -> str:
        return str(self.value)
