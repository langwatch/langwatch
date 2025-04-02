import json
from typing import List, Union, cast
from langwatch.domain import RAGChunk
from pydantic import ValidationError


class SerializableWithStringFallback(json.JSONEncoder):
    def default(self, o):
        try:
            if hasattr(o, "model_dump"):
                return o.model_dump(exclude_unset=True)
            if isinstance(o, set):
                return list(o)
            return super().default(o)
        except:
            return str(o)

def validate_safe(type_, item: dict, min_required_keys_for_pydantic_1: List[str]):
    import pydantic

    if type(item) != dict or not all(
        key in item for key in min_required_keys_for_pydantic_1
    ):
        return False

    if pydantic.__version__.startswith("2."):
        from pydantic import TypeAdapter

        try:
            TypeAdapter(type_).validate_python(item)
            return True
        except ValidationError:
            try:
                TypeAdapter(type_).validate_json(
                    json.dumps(item, cls=SerializableWithStringFallback)
                )
                return True
            except ValidationError:
                return False


def autoconvert_rag_contexts(value: Union[List[RAGChunk], List[str]]) -> List[RAGChunk]:
    if type(value) == list and all(
        validate_safe(RAGChunk, cast(dict, item), ["content"]) for item in value
    ):
        return cast(List[RAGChunk], value)
    if type(value) == list and all(isinstance(item, str) for item in value):
        return [RAGChunk(content=str(item)) for item in value]
    raise ValueError(
        'Invalid RAG contexts, expected list of string or list of {"document_id": Optional[str], "chunk_id": Optional[str], "content": str} dicts'
    )
