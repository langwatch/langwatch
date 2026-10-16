"""Signature analysis: turn fields, run parameters and their JSON Schema.

The decorator reads the function signature once. The six turn fields are
passed by declared name; every other parameter is a run parameter, typed by
its annotation and defaulted by its default value. The schema this module
builds is the `parameters` object of the `register` frame.
"""

from __future__ import annotations

import enum
import inspect
import json
import types
import typing
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import (
    Annotated,
    Any,
    Literal,
    Union,
    get_args,
    get_origin,
)

from pydantic import BaseModel, TypeAdapter, ValidationError
from pydantic_core import to_jsonable_python

TURN_FIELDS = ("messages", "new_messages", "thread_id", "session", "state", "trace_id")
"""The fields the platform sends on every call, in the order the frame lists them."""

STATE_MAX_BYTES = 64 * 1024
"""The cap on a scenario hook's state and on teardown's returned object (ADR-180)."""

_JSON_TYPES: dict[Any, str] = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
}

_PYTHON_TYPES: dict[str, Any] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
}

_NONE_TYPE = type(None)


class _Missing:
    def __repr__(self) -> str:
        return "MISSING"


MISSING: Any = _Missing()
"""Marks a parameter with no default: the run must supply it."""


class AgentParameterInvalid(Exception):
    """A run parameter is missing or its value does not fit the annotation.

    Raised before the function runs and answered to the platform as the
    `agent_parameter_invalid` error code.
    """

    code = "agent_parameter_invalid"

    def __init__(self, *, parameter: str, message: str) -> None:
        super().__init__(f"parameter {parameter!r}: {message}")
        self.parameter = parameter
        self.message = message


ACCEPTED_REPLY_SHAPES = (
    "a string, a message dict with a role and content, "
    "a list of such messages, or AgentReply(output, session=...)"
)


class AgentReplyInvalid(TypeError):
    """The function returned a value the platform cannot read as an answer.

    The platform reads a result's output as text, one message or a list of
    messages, and a message must carry a role. Anything else, a plain dict of
    fields for example, would be dropped by the platform without an answer,
    so the value is refused here and answered as the `agent_call_failed`
    error code with the accepted shapes in the message.
    """

    code = "agent_call_failed"

    def __init__(self, *, reason: str) -> None:
        super().__init__(f"returned {reason}; return {ACCEPTED_REPLY_SHAPES}")
        self.reason = reason


class AgentStateInvalid(TypeError):
    """A hook or a turn returned a state that is not a JSON object.

    Answered to the platform as `agent_call_failed`, naming the state.
    """

    code = "agent_call_failed"

    def __init__(self, *, reason: str) -> None:
        super().__init__(
            f"returned a state that is {reason}; return a JSON object or None"
        )
        self.reason = reason


class AgentPayloadTooLarge(ValueError):
    """A state is above its cap, answered as `agent_payload_too_large`."""

    code = "agent_payload_too_large"

    def __init__(self, *, size_bytes: int, limit_bytes: int) -> None:
        super().__init__(
            f"The state is {size_bytes} bytes, above the limit of {limit_bytes} bytes."
        )
        self.size_bytes = size_bytes
        self.limit_bytes = limit_bytes


class HookNotDeclared(Exception):
    """The platform called a scenario hook this agent does not have."""

    code = "hook_not_declared"

    def __init__(self, *, agent: str, kind: str) -> None:
        super().__init__(f"{agent} declares no {kind} hook")
        self.kind = kind


class ParameterConflict(ValueError):
    """Two signatures declare one run parameter with different types or defaults.

    A run has one value per name, shared by the agent and its hooks. The
    platform refuses a schema that cannot hold both as `parameters_invalid`,
    so the SDK refuses it first, at decoration.
    """

    code = "parameters_invalid"

    def __init__(self, *, parameter: str, reason: str) -> None:
        super().__init__(
            f"run parameter {parameter!r} {reason}; the agent and its hooks share "
            "one value per name, so they must declare it alike"
        )
        self.parameter = parameter


def coerce_state(value: Any) -> dict[str, Any] | None:
    """The state a call answers with: None, or a JSON object under the cap."""
    if value is None:
        return None
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    if not isinstance(value, Mapping):
        raise AgentStateInvalid(reason=f"a {type(value).__name__}, not an object")
    try:
        # The platform measures `JSON.stringify`, which has no spaces.
        encoded = json.dumps(
            value, separators=(",", ":"), ensure_ascii=False, allow_nan=False
        )
    except (TypeError, ValueError) as error:
        raise AgentStateInvalid(reason=f"not JSON ({error})") from None
    size = len(encoded.encode("utf-8"))
    if size > STATE_MAX_BYTES:
        raise AgentPayloadTooLarge(size_bytes=size, limit_bytes=STATE_MAX_BYTES)
    return dict(value)


@dataclass(frozen=True)
class Param:
    """Metadata for one run parameter, used through `Annotated`.

    Example:
        model: Annotated[str, Param(description="The model", options=["a", "b"])] = "a"
    """

    description: str | None = None
    options: Sequence[Any] | None = None


@dataclass
class ParameterSpec:
    """One run parameter: how it is validated and how it is declared."""

    name: str
    annotation: Any = Any
    default: Any = MISSING
    description: str | None = None
    options: list[Any] | None = None
    schema: dict[str, Any] = field(default_factory=dict)
    _adapter: TypeAdapter[Any] | None = field(default=None, repr=False)

    @property
    def required(self) -> bool:
        return self.default is MISSING

    def validate(self, value: Any) -> Any:
        """The value the function receives, or `AgentParameterInvalid`."""
        if self._adapter is not None:
            try:
                value = self._adapter.validate_python(value)
            except ValidationError as error:
                first = error.errors()[0] if error.errors() else None
                message = first["msg"] if first else str(error)
                raise AgentParameterInvalid(
                    parameter=self.name, message=message
                ) from None
        if self.options is not None:
            plain = value.value if isinstance(value, enum.Enum) else value
            if plain not in self.options and value not in self.options:
                raise AgentParameterInvalid(
                    parameter=self.name,
                    message=f"value {plain!r} is not one of {list(self.options)!r}",
                )
        return value


def _unwrap_annotated(annotation: Any) -> tuple[Any, Param | None]:
    if get_origin(annotation) is Annotated:
        args = get_args(annotation)
        param = next((a for a in args[1:] if isinstance(a, Param)), None)
        return args[0], param
    return annotation, None


def _unwrap_optional(annotation: Any) -> tuple[Any, bool]:
    origin = get_origin(annotation)
    if origin is not Union and origin is not types.UnionType:
        return annotation, False
    args = [a for a in get_args(annotation) if a is not _NONE_TYPE]
    if len(args) == len(get_args(annotation)):
        return annotation, False
    if len(args) == 1:
        return args[0], True
    return Union[tuple(args)], True  # type: ignore[return-value]


def _type_of_values(values: Sequence[Any]) -> str | None:
    kinds = {_JSON_TYPES.get(type(v)) for v in values}
    if len(kinds) == 1:
        return kinds.pop()
    return None


def _jsonable(value: Any) -> Any:
    if isinstance(value, enum.Enum):
        return value.value
    try:
        return to_jsonable_python(value)
    except Exception:
        return str(value)


def _property_schema(annotation: Any, *, param: Param | None) -> dict[str, Any]:
    """The JSON Schema property for one annotation."""
    schema: dict[str, Any] = {}
    options: list[Any] | None = None

    if annotation is inspect.Parameter.empty or annotation is Any:
        schema["type"] = "string"
    elif annotation in _JSON_TYPES:
        schema["type"] = _JSON_TYPES[annotation]
    elif get_origin(annotation) is Literal:
        options = [_jsonable(v) for v in get_args(annotation)]
    elif inspect.isclass(annotation) and issubclass(annotation, enum.Enum):
        options = [_jsonable(member.value) for member in annotation]
    else:
        try:
            schema = dict(TypeAdapter(annotation).json_schema())
        except Exception:
            schema = {"type": "string"}

    if param is not None and param.options is not None:
        options = [_jsonable(v) for v in param.options]
    if options is not None:
        kind = _type_of_values(options)
        if kind is not None:
            schema["type"] = kind
        schema["enum"] = options
    if param is not None and param.description:
        schema["description"] = param.description
    return schema


def _spec_from_annotation(*, name: str, annotation: Any, default: Any) -> ParameterSpec:
    base, param = _unwrap_annotated(annotation)
    inner, _ = _unwrap_optional(base)
    schema = _property_schema(inner, param=param)
    if default is not MISSING:
        schema["default"] = _jsonable(default)
    adapter: TypeAdapter[Any] | None = None
    if base is not inspect.Parameter.empty and base is not Any:
        try:
            adapter = TypeAdapter(base)
        except Exception:
            adapter = None
    return ParameterSpec(
        name=name,
        annotation=base,
        default=default,
        description=param.description if param else None,
        options=list(param.options) if param and param.options is not None else None,
        schema=schema,
        _adapter=adapter,
    )


def _spec_from_definition(*, name: str, definition: Mapping[str, Any]) -> ParameterSpec:
    """A parameter from an explicit definition map or a JSON Schema property.

    Both shapes carry `type`, `options` or `enum`, `default` and `description`.
    """
    options = definition.get("options", definition.get("enum"))
    default = definition.get("default", MISSING)
    declared_type = definition.get("type")
    if declared_type is None and options:
        # An `enum` of objects, arrays or mixed scalars carries no single JSON
        # type. The parameter stays untyped rather than claiming "string",
        # which would refuse every value the list holds.
        declared_type = _type_of_values(list(options))
    elif declared_type is None and default is not MISSING:
        declared_type = _JSON_TYPES.get(type(default))
    elif declared_type is None:
        declared_type = "string"
    python_type = _PYTHON_TYPES.get(str(declared_type), Any)
    annotation: Any = python_type
    if options:
        try:
            annotation = Literal[tuple(options)]  # type: ignore[valid-type]
        except TypeError:
            # `Literal` refuses a value it cannot take as a parameter. The
            # membership check against `options` still rejects a value that
            # the list does not hold.
            annotation = python_type
    schema: dict[str, Any] = {}
    if declared_type is not None:
        schema["type"] = declared_type
    if options:
        schema["enum"] = list(options)
    if definition.get("description"):
        schema["description"] = definition["description"]
    if default is not MISSING:
        schema["default"] = _jsonable(default)
    try:
        adapter = TypeAdapter(annotation) if annotation is not Any else None
    except Exception:
        # The reflected path already degrades this way. A parameter the
        # adapter cannot describe is still checked against `options` and the
        # declared type, so the decorated function keeps working.
        adapter = None
    return ParameterSpec(
        name=name,
        annotation=annotation,
        default=default,
        description=definition.get("description"),
        options=list(options) if options else None,
        schema=schema,
        _adapter=adapter,
    )


@dataclass
class AgentSignature:
    """What the decorator learned from the function signature."""

    turn_fields: list[str] = field(default_factory=list)
    has_kwargs: bool = False
    call_parameter: str | None = None
    parameters: dict[str, ParameterSpec] = field(default_factory=dict)

    def json_schema(self) -> dict[str, Any]:
        """The `parameters` object of the register frame."""
        properties = {name: dict(spec.schema) for name, spec in self.parameters.items()}
        schema: dict[str, Any] = {"type": "object", "properties": properties}
        required = [name for name, spec in self.parameters.items() if spec.required]
        if required:
            schema["required"] = required
        return schema

    def resolve_parameters(self, supplied: Mapping[str, Any]) -> dict[str, Any]:
        """Validated values for every declared parameter.

        A parameter the run did not send takes its default. One with no
        default that the run did not send raises `AgentParameterInvalid`, and
        so does a value that does not fit its annotation.
        """
        resolved: dict[str, Any] = {}
        for name, spec in self.parameters.items():
            if name in supplied:
                resolved[name] = spec.validate(supplied[name])
            elif spec.required:
                raise AgentParameterInvalid(
                    parameter=name, message="required parameter was not supplied"
                )
            else:
                resolved[name] = spec.default
        return resolved


def _is_agent_call_annotation(annotation: Any, agent_call_type: type) -> bool:
    if annotation is agent_call_type:
        return True
    if isinstance(annotation, str):
        return annotation.split(".")[-1] == agent_call_type.__name__
    return False


def _type_hints(func: Callable[..., Any]) -> dict[str, Any]:
    try:
        return typing.get_type_hints(func, include_extras=True)
    except Exception:
        return {}


_NUMERIC_TYPES = {"integer", "number"}


def _merged_spec(
    name: str, existing: ParameterSpec, spec: ParameterSpec
) -> ParameterSpec:
    """One spec for a name two signatures declare, or `ParameterConflict`."""
    types = (existing.schema.get("type"), spec.schema.get("type"))
    numeric = set(types) <= _NUMERIC_TYPES
    if types[0] != types[1] and not numeric:
        raise ParameterConflict(
            parameter=name, reason=f"is declared as {types[0]} and as {types[1]}"
        )
    if not existing.required and not spec.required and existing.default != spec.default:
        raise ParameterConflict(
            parameter=name,
            reason=f"has the default {existing.default!r} and the default {spec.default!r}",
        )
    kept = spec if spec.required and not existing.required else existing
    if numeric and types[0] != types[1]:
        # An integer is a number; the schema says number so either value fits.
        kept = replace(kept, schema={**kept.schema, "type": "number"})
    return kept


def merge_parameters(*signatures: AgentSignature) -> dict[str, ParameterSpec]:
    """One run-parameter set for an agent and its hooks.

    A name declared twice must carry one JSON type (integer and number merge
    as number) and one default, or `ParameterConflict` names it. A name any
    signature requires stays required.
    """
    merged: dict[str, ParameterSpec] = {}
    for signature in signatures:
        for name, spec in signature.parameters.items():
            existing = merged.get(name)
            merged[name] = (
                spec if existing is None else _merged_spec(name, existing, spec)
            )
    return merged


def analyze_signature(
    func: Callable[..., Any],
    *,
    agent_call_type: type,
    parameters: Mapping[str, Any] | None = None,
    skip: int = 0,
) -> AgentSignature:
    """Read the signature once.

    `parameters`, when given, replaces the run parameters read from the
    signature. It is a definition map (`{name: {type, options, default,
    description}}`) or a JSON Schema object with `properties`. `skip` leaves
    out the leading positional parameters a scenario hook receives (`run`,
    and `state` for teardown).
    """
    signature = inspect.signature(func)
    hints = _type_hints(func)
    result = AgentSignature()
    reflected: dict[str, ParameterSpec] = {}

    for index, (name, parameter) in enumerate(signature.parameters.items()):
        if index < skip:
            continue
        if parameter.kind is inspect.Parameter.VAR_KEYWORD:
            result.has_kwargs = True
            continue
        if parameter.kind is inspect.Parameter.VAR_POSITIONAL:
            continue
        annotation = hints.get(name, parameter.annotation)
        if index == 0 and _is_agent_call_annotation(annotation, agent_call_type):
            result.call_parameter = name
            continue
        if name in TURN_FIELDS:
            result.turn_fields.append(name)
            continue
        default = (
            MISSING
            if parameter.default is inspect.Parameter.empty
            else parameter.default
        )
        reflected[name] = _spec_from_annotation(
            name=name, annotation=annotation, default=default
        )

    if parameters is None:
        result.parameters = reflected
        return result

    definitions: Mapping[str, Any]
    is_json_schema = parameters.get("type") == "object" and isinstance(
        parameters.get("properties"), Mapping
    )
    if is_json_schema:
        definitions = parameters["properties"]
        required = set(parameters.get("required") or ())
    else:
        definitions = parameters
        required = set(definitions.keys())
    for name, definition in definitions.items():
        if name in TURN_FIELDS:
            continue
        spec = _spec_from_definition(name=name, definition=definition or {})
        if spec.default is MISSING and name not in required:
            spec.default = None
        result.parameters[name] = spec
    return result
