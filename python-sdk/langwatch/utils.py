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
    if type(value) == str:
        return TypedValueText(type="text", value=value)
    if type(value) == dict and validate_safe(SpanInputOutput, value):
        return cast(SpanInputOutput, value)
    if type(value) == list and all(validate_safe(ChatMessage, item) for item in value):
        return TypedValueChatMessages(type="chat_messages", value=value)

    try:
        import chainlit as cl

        if type(value) == dict:
            value_ = value.copy()
            for key, v in value_.items():
                if isinstance(v, cl.Message):
                    value_[key] = cast(cl.Message, v).to_dict()
            return TypedValueJson(type="json", value=value_)
    except ImportError:
        pass

    try:
        json_ = json.dumps(value, cls=SerializableAndPydanticEncoder)
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
        if isinstance(o, BaseModel):
            return o.model_dump()
        return super().default(o)
