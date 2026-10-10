"""Reading a judge's verdict out of the function call it was asked to make.

A forced tool_choice is a request, not a guarantee (and falls back to "auto"
on models that refuse it), so the answer is checked before any field is read.
"""

import json
from typing import Any, Optional, Sequence


class JudgeAnswerError(Exception):
    """The evaluator model answered without a usable call to the verdict function."""

    def __init__(self, tool_name: str, problem: str, model: Optional[str] = None):
        subject = f"The evaluator model {model}" if model else "The evaluator model"
        super().__init__(
            f"{subject} {problem}, so no verdict could be read from the "
            f"`{tool_name}` function call. Retry the evaluation, or choose "
            f"an evaluator model that supports function calling."
        )
        self.tool_name = tool_name
        self.model = model


def read_tool_call_arguments(
    response: Any,
    tool_name: str,
    required: Sequence[str] = (),
    model: Optional[str] = None,
) -> dict:
    """The arguments of the response's call to `tool_name`, checked to be a JSON
    object carrying every `required` field, or JudgeAnswerError."""
    try:
        message = response.choices[0].message
    except (AttributeError, IndexError, TypeError):
        raise JudgeAnswerError(tool_name, "returned no answer", model)

    tool_calls = getattr(message, "tool_calls", None) or []
    matching = [
        call
        for call in tool_calls
        if getattr(getattr(call, "function", None), "name", tool_name) in (tool_name, None)
    ]
    if not matching and getattr(response.choices[0], "finish_reason", None) == "content_filter":
        raise JudgeAnswerError(tool_name, "refused to answer (content filter)", model)
    if not matching:
        raise JudgeAnswerError(tool_name, "answered without calling the function", model)

    try:
        arguments = json.loads(matching[0].function.arguments)
    except (TypeError, ValueError):
        raise JudgeAnswerError(tool_name, "sent function arguments that are not valid JSON", model)
    if not isinstance(arguments, dict):
        raise JudgeAnswerError(tool_name, "sent function arguments that are not an object", model)

    missing = [field for field in required if arguments.get(field) is None]
    if missing:
        raise JudgeAnswerError(
            tool_name, f"left out the required field(s) {', '.join(missing)}", model
        )
    return arguments


def read_boolean(value: Any) -> Optional[bool]:
    """A boolean field as the model sent it; the strings "true"/"false" count."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in ("true", "false"):
        return value.strip().lower() == "true"
    return None
