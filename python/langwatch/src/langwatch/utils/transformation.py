

from ctypes import Union
from langwatch.domain import ChatMessage, EvaluationResult, SpanInputOutput, TypedValueChatMessages, TypedValueEvaluationResult, TypedValueJson, TypedValueRaw, TypedValueText, RAGChunk
import json
from typing import List, Union, cast
from pydantic import BaseModel, ValidationError


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


def convert_typed_values(
    value: Union[SpanInputOutput, ChatMessage, str, dict, list]
) -> SpanInputOutput:
    value_ = value

    if type(value_) == str:
        return TypedValueText(type="text", value=value_)
    if type(value_) == dict and validate_safe(
        SpanInputOutput, value_, ["type", "value"]
    ):
        return cast(SpanInputOutput, value_)
    if (
        type(value_) == list
        and len(value_) > 0
        and all(validate_safe(ChatMessage, item, ["role"]) for item in value_)
    ):
        return TypedValueChatMessages(type="chat_messages", value=value_)

    if isinstance(value_, BaseModel) and value_.__class__.__name__ in [
        "EvaluationResult",
        "EvaluationResultSkipped",
        "EvaluationResultError",
    ]:
        return TypedValueEvaluationResult(
            type="evaluation_result",
            value=cast(
                EvaluationResult,
                value_.model_dump(exclude_unset=False, exclude_none=True),
            ),
        )

    try:
        json_ = json.dumps(value, cls=SerializableWithStringFallback)
        return TypedValueJson(type="json", value=json.loads(json_))
    except:
        return TypedValueRaw(type="raw", value=str(value_))

