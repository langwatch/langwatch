import json
import time
import traceback
from typing import (
    Any,
    AsyncGenerator,
    Callable,
    Dict,
    Generator,
    List,
    Optional,
    Tuple,
    TypeVar,
    Union,
    cast,
)

from pydantic import BaseModel, TypeAdapter, ValidationError

from langwatch.types import (
    ChatMessage,
    ErrorCapture,
    RAGChunk,
    SpanInputOutput,
    TypedValueChatMessages,
    TypedValueJson,
    TypedValueRaw,
    TypedValueText,
)

T = TypeVar("T")


def safe_get(d: Union[Dict[str, Any], BaseModel], *keys: str) -> Optional[Any]:
    for key in keys:
        if d == None:
            return None
        if isinstance(d, dict):
            d = d.get(key, None)
        if hasattr(d, key):
            d = getattr(d, key)
        else:
            return None
    return d


def milliseconds_timestamp():
    return int(time.time() * 1000)


def capture_chunks_with_timings_and_reyield(
    generator: Generator[T, Any, Any],
    callback: Callable[[List[T], Optional[int], int], Any],
) -> Generator[T, Any, Any]:
    chunks = []
    first_token_at: Optional[int] = None
    for chunk in generator:
        chunks.append(chunk)
        if not first_token_at:
            first_token_at = milliseconds_timestamp()
        yield chunk
    finished_at = milliseconds_timestamp()
    callback(chunks, first_token_at, finished_at)


async def capture_async_chunks_with_timings_and_reyield(
    generator: AsyncGenerator[T, Any],
    callback: Callable[[List[T], Optional[int], int], Any],
) -> AsyncGenerator[T, Any]:
    chunks = []
    first_token_at: Optional[int] = None
    async for chunk in generator:
        chunks.append(chunk)
        if not first_token_at:
            first_token_at = milliseconds_timestamp()
        yield chunk
    finished_at = milliseconds_timestamp()
    callback(chunks, first_token_at, finished_at)


def capture_exception(err: BaseException):
    try:  # python < 3.10
        string_stacktrace = traceback.format_exception(
            etype=type(err), value=err, tb=err.__traceback__
        )  # type: ignore
    except:  # python 3.10+
        string_stacktrace = traceback.format_exception(err)  # type: ignore
    return ErrorCapture(message=str(err), stacktrace=string_stacktrace)


def list_get(l, i, default=None):
    try:
        return l[i]
    except IndexError:
        return default


def validate_safe(type, item: dict):
    try:
        TypeAdapter(type).validate_python(item)
        return True
    except ValidationError:
        return False


def autoconvert_typed_values(
    value: Union[SpanInputOutput, ChatMessage, str, dict, list]
) -> SpanInputOutput:
    value_ = value

    if type(value_) == str:
        return TypedValueText(type="text", value=value_)
    if type(value_) == dict and validate_safe(SpanInputOutput, value_):
        return cast(SpanInputOutput, value_)
    if type(value_) == list and all(
        validate_safe(ChatMessage, item) for item in value_
    ):
        return TypedValueChatMessages(type="chat_messages", value=value_)

    try:
        json_ = json.dumps(value, cls=SerializableWithStringFallback)
        return TypedValueJson(type="json", value=json.loads(json_))
    except:
        return TypedValueRaw(type="raw", value=str(value))


def autoconvert_rag_contexts(value: Union[List[RAGChunk], List[str]]) -> List[RAGChunk]:
    if type(value) == list and all(
        validate_safe(RAGChunk, cast(dict, item)) for item in value
    ):
        return cast(List[RAGChunk], value)
    if type(value) == list and all(isinstance(item, str) for item in value):
        return [RAGChunk(content=str(item)) for item in value]
    raise ValueError(
        'Invalid RAG contexts, expected list of string or list of {"document_id": Optional[str], "chunk_id": Optional[str], "content": str} dicts'
    )


class SerializableAndPydanticEncoder(json.JSONEncoder):
    def default(self, o):
        try:
            from langchain_core.load.serializable import Serializable  # type: ignore

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
            return o.model_dump()
        return super().default(o)


class SerializableWithStringFallback(SerializableAndPydanticEncoder):
    def default(self, o):
        try:
            return super().default(o)
        except:
            return str(o)


def reduce_payload_size(
    obj: T, max_string_length=5000, max_list_dict_length=50000
) -> T:
    if type(obj) == list and all(validate_safe(ChatMessage, item) for item in obj):
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
            return reduce_payload_size(item, max_string_length, max_list_dict_length)
        else:
            return item

    if isinstance(obj, str):
        return truncate_string(obj)

    elif isinstance(obj, list):
        result = []
        for item in obj:
            result.append(process_item(item))
            if (
                len(json.dumps(result, cls=SerializableAndPydanticEncoder))
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
                len(json.dumps(result, cls=SerializableAndPydanticEncoder))
                > max_list_dict_length
            ):
                del result[key]
                result["..."] = "(truncated object)"
                break
        return cast(T, result)

    else:
        return obj
