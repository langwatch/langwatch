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

from pydantic import BaseModel

from langwatch.types import (
    ErrorCapture,
    SpanInputOutput,
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


def autoconvert_typed_values(value: Any) -> SpanInputOutput:
    if type(value) == dict and "type" in value:
        return cast(SpanInputOutput, value)
    if type(value) == str:
        return TypedValueText(type="text", value=value)
    else:
        try:
            json_ = json.dumps(value, cls=SerializableAndPydanticEncoder)
            return TypedValueJson(type="json", value=json.loads(json_))
        except:
            return TypedValueRaw(type="raw", value=str(value))


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
