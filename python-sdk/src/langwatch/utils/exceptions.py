import traceback
from typing import Any, List, Mapping, Optional, cast, Type

from langwatch.domain import ErrorCapture
import httpx


def _first_string(*candidates: Any) -> Optional[str]:
    for candidate in candidates:
        if isinstance(candidate, str) and candidate:
            return candidate
    return None


def extract_api_error_detail(body: Any) -> str:
    """Build a readable detail line from a LangWatch API error body.

    The API never sends a handled error's own message: that text is written for
    the server's logs and can name internal configuration, so the wire carries
    the stable ``code`` instead. Prose appears only when the server deliberately
    authored some, as ``meta.message``. Remediation (``tips``, ``docsUrl``) is
    written to be shown, so it is appended when present -- that channel exists
    precisely so callers without a UI can still self-diagnose.

    Reads the discriminant as ``code`` -> ``type`` -> ``kind``; the platform
    sets all three to the same value (``type`` is the OpenAI-compatible name
    Go emits), so the order only decides which answers first.
    """
    if not isinstance(body, Mapping):
        return ""

    code = _first_string(body.get("code"), body.get("type"), body.get("kind"))

    meta = body.get("meta")
    authored = meta.get("message") if isinstance(meta, Mapping) else None

    message = body.get("message")
    if isinstance(message, str) and message == code:
        # Equal to the code, so it adds nothing.
        message = None

    # `error` is the code on some legacy routes and the HTTP status text on
    # unversioned ones -- only useful when nothing better named the failure.
    detail = _first_string(authored, message, code, body.get("error")) or ""

    tips = body.get("tips")
    if isinstance(tips, list):
        for tip in tips:
            if isinstance(tip, str) and tip:
                detail = f"{detail}\n  tip: {tip}" if detail else f"tip: {tip}"

    docs_url = _first_string(body.get("docsUrl"), body.get("docs_url"))
    if docs_url:
        detail = f"{detail}\n  docs: {docs_url}" if detail else f"docs: {docs_url}"

    return detail


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

        if "error" in json or "code" in json:
            detail = extract_api_error_detail(json)
            message = (
                f"{response.status_code} {detail}"
                if detail
                else str(response.status_code)
            )
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