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
)

from langwatch.types import (
    ErrorCapture,
    SpanOutput,
    TypedValueJson,
    TypedValueRaw,
    TypedValueText,
)

T = TypeVar("T")


def safe_get(d: Dict[str, Any], *keys: str) -> Optional[Any]:
    for key in keys:
        if not isinstance(d, dict):
            return None
        d = d.get(key)  # type: ignore
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
    string_stacktrace = traceback.format_exception(
        etype=type(err), value=err, tb=err.__traceback__
    )
    return ErrorCapture(message=str(err), stacktrace=string_stacktrace)


def list_get(l, i, default=None):
    try:
        return l[i]
    except IndexError:
        return default


def autoconvert_typed_values(value: Any) -> SpanOutput:
    if type(value) == str:
        return TypedValueText(type="text", value=value)
    else:
        try:
            _ = json.dumps(value)
            return TypedValueJson(type="json", value=value)
        except:
            return TypedValueRaw(type="raw", value=str(value))
