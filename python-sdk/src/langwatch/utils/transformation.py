from langwatch.domain import (
    ChatMessage,
    EvaluationResult,
    SpanInputOutput,
    TypedValueChatMessages,
    TypedValueEvaluationResult,
    TypedValueJson,
    TypedValueRaw,
    TypedValueText,
    RAGChunk,
)
import json
import math
from typing import Any, Dict, List, Optional, TypeVar, Union, cast
from pydantic import BaseModel, ValidationError
import pydantic


T = TypeVar("T")


class SerializableAndPydanticEncoder(json.JSONEncoder):
    def default(self, o):
        try:
            import langchain_core.messages
            from langwatch.langchain import langchain_message_to_chat_message

            if isinstance(o, langchain_core.messages.BaseMessage):
                return langchain_message_to_chat_message(o)
        except ImportError:
            pass

        try:
            from langchain_core.load.serializable import Serializable

            if isinstance(o, Serializable):
                return o.__repr__()
        except ImportError:
            pass

        try:
            import chainlit as cl

            if isinstance(o, cl.Message):
                return o.to_dict()
        except ImportError:
            pass

        if isinstance(o, BaseModel):
            return o.model_dump(exclude_unset=True)
        if issubclass(o, BaseModel):  # type: ignore
            return {"__class__": o.__name__, "json_schema": o.model_json_schema()}
        return super().default(o)


class SerializableWithStringFallback(SerializableAndPydanticEncoder):
    """JSON encoder that handles non-serializable objects by falling back to str().

    Also converts NaN and Infinity float values to None, since these are not
    valid JSON (Python's json module outputs bare NaN/Infinity tokens which
    break RFC 8259-compliant parsers). This commonly occurs with pandas
    DataFrames where missing values are represented as float('nan').
    """

    def __init__(self, *args: Any, **kwargs: Any):
        kwargs["allow_nan"] = False
        super().__init__(*args, **kwargs)

    def default(self, o: Any) -> Any:
        try:
            if hasattr(o, "model_dump"):
                result = o.model_dump(exclude_unset=True)
            elif isinstance(o, set):
                result = list(o)
            else:
                result = super().default(o)
            return _sanitize_nan(result)
        except Exception:
            return str(o)

    def encode(self, o: Any) -> str:
        return super().encode(_sanitize_nan(o))

    def iterencode(self, o: Any, _one_shot: bool = False) -> Any:
        return super().iterencode(_sanitize_nan(o), _one_shot)


def _sanitize_nan(obj: Any) -> Any:
    """Recursively replace NaN and Infinity float values with None."""
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: _sanitize_nan(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        # JSON has no tuple type; coerce to list
        return [_sanitize_nan(v) for v in obj]
    return obj


def validate_safe(
    type_: Any, item: Dict[str, Any], min_required_keys_for_pydantic_1: List[str]
):
    """Safely validate a dictionary against a type, handling both TypedDict and BaseModel."""
    if not isinstance(item, dict) or not all(  # type: ignore
        key in item for key in min_required_keys_for_pydantic_1
    ):
        return False

    # Handle TypedDict
    if hasattr(type_, "__annotations__"):
        try:
            # Check if all required fields are present
            required_fields = getattr(type_, "__required_keys__", set())
            if not all(key in item for key in required_fields):
                return False

            # Check if all values match their annotations
            annotations = type_.__annotations__
            return all(
                key not in item or isinstance(item[key], annotations[key])
                for key in annotations
            )
        except (AttributeError, TypeError):
            pass

    # Handle Pydantic models
    if pydantic.__version__.startswith("2."):
        from pydantic import TypeAdapter

        try:
            TypeAdapter(type_).validate_python(item)
            return True
        except (ValidationError, AttributeError, TypeError):
            try:
                TypeAdapter(type_).validate_json(
                    json.dumps(item, cls=SerializableWithStringFallback)
                )
                return True
            except (ValidationError, AttributeError, TypeError):
                return False

    return False


def rag_contexts(value: Union[List[RAGChunk], List[str]]) -> List[RAGChunk]:
    if type(value) == list and all(
        validate_safe(RAGChunk, cast(Dict[str, Any], item), ["content"])
        for item in value
    ):
        return cast(List[RAGChunk], value)
    if type(value) == list and all(isinstance(item, str) for item in value):
        return [RAGChunk(content=str(item)) for item in value]
    raise ValueError(
        'Invalid RAG contexts, expected list of string or list of {"document_id": Optional[str], "chunk_id": Optional[str], "content": str} dicts'
    )


def convert_typed_values(
    value: Union[SpanInputOutput, ChatMessage, str, Dict[str, Any], List[Any]],
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
    """No-op kept for backwards compatibility with callers.

    This function previously truncated large objects, silently replacing
    dict keys and list items with truncation markers. That caused data
    loss (e.g. workflow end-node outputs being dropped). It now returns
    *obj* unchanged. All parameters beyond *obj* are ignored.
    """
    return obj
