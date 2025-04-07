

from ctypes import Union
from langwatch.domain import ChatMessage, EvaluationResult, SpanInputOutput, TypedValueChatMessages, TypedValueEvaluationResult, TypedValueJson, TypedValueRaw, TypedValueText, RAGChunk
import json
from typing import List, Optional, TypeVar, Union, cast
from pydantic import BaseModel, ValidationError


T = TypeVar("T")


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


def rag_contexts(value: Union[List[RAGChunk], List[str]]) -> List[RAGChunk]:
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


def truncate_object_recursively(
    obj: T,
    max_string_length: Optional[int] = None,
    max_list_dict_length: int = 50000,
    depth: int = 0,
) -> T:
    """Truncate strings and lists/dicts in an object recursively."""

    if max_string_length is None:
        return obj

    if max_string_length < 100:
        raise ValueError("max_string_length must be at least 100")

    if type(obj) == list and all(
        validate_safe(ChatMessage, item, ["role"]) for item in obj
    ):
        return obj

    def truncate_string(s):
        return (
            s[:max_string_length] + "... (truncated string)"
            if len(s) > max_string_length
            else s
        )

    def process_item(item):
        if isinstance(item, str):
            return truncate_string(item)
        elif isinstance(item, (list, dict)):
            return truncate_object_recursively(
                item, max_string_length, max_list_dict_length, depth=depth + 1
            )
        else:
            return item

    if isinstance(obj, str):
        return truncate_string(obj)

    elif isinstance(obj, list):
        result = []
        for item in obj:
            result.append(process_item(item))
            if (
                max_list_dict_length != -1
                and len(json.dumps(result, cls=SerializableWithStringFallback))
                > max_list_dict_length
            ):
                result.pop()
                result.append("... (truncated list)")
                break
        return cast(T, result)

    elif isinstance(obj, dict):
        result = {}
        for key, value in obj.items():
            result[key] = process_item(value)
            if (
                depth > 0
                and max_list_dict_length != -1
                and len(json.dumps(result, cls=SerializableWithStringFallback))
                > max_list_dict_length
            ):
                del result[key]
                result["..."] = "(truncated object)"
                break
        return cast(T, result)

    else:
        return obj

