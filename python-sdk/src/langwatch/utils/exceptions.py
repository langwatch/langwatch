import traceback
from typing import List, cast, Type

from langwatch.domain import ErrorCapture
import httpx


def capture_exception(err: BaseException):
    try:  # python < 3.10
        string_stacktrace = cast(List[str], traceback.format_exception(
            etype=type(err), value=err, tb=err.__traceback__
        ))  # type: ignore
    except:  # python 3.10+
        string_stacktrace = traceback.format_exception(err)  # type: ignore
    return ErrorCapture(message=repr(err), stacktrace=string_stacktrace)


class EvaluatorException(Exception):
    pass


def better_raise_for_status(response: httpx.Response, cls: Type[BaseException] = httpx.HTTPStatusError) -> None:
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as http_err:
        try:
            json = response.json()
        except Exception:
            raise http_err

        if "error" in json:
            error = json["error"]
            message = f"{response.status_code} {error}"
            # httpx.HTTPStatusError (the default cls) has request/response as
            # required keyword-only args; constructing it with only a message
            # raises a TypeError that masks the real server error. Pass them
            # through for HTTPStatusError, and fall back to a plain message for
            # any other exception type.
            if isinstance(cls, type) and issubclass(cls, httpx.HTTPStatusError):
                raise cls(
                    message, request=response.request, response=response
                ) from http_err
            raise cls(message) from http_err
        else:
            raise http_err