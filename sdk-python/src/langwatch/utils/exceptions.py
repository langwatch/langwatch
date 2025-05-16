import traceback
from typing import List, cast

from langwatch.domain import ErrorCapture


def capture_exception(err: BaseException):
    try:  # python < 3.10
        string_stacktrace = cast(List[str], traceback.format_exception(
            etype=type(err), value=err, tb=err.__traceback__
        ))  # type: ignore
    except:  # python 3.10+
        string_stacktrace = traceback.format_exception(err)  # type: ignore
    return ErrorCapture(message=repr(err), stacktrace=string_stacktrace)
