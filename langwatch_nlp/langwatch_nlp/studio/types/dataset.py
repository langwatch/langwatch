from typing import List, Dict, Union, Optional, Literal
from pydantic import BaseModel, Field as PydanticField
from enum import Enum

class DatasetColumnType(str, Enum):
    string = "string"
    boolean = "boolean"
    number = "number"
    date = "date"
    list = "list"
    json = "json"
    spans = "spans"
    rag_contexts = "rag_contexts"
    chat_messages = "chat_messages"
    annotations = "annotations"
    evaluations = "evaluations"

class DatasetColumn(BaseModel):
    name: str
    type: DatasetColumnType

DatasetColumns = List[DatasetColumn]