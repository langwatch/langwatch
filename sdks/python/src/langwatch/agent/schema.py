"""Signature analysis: turn fields, run parameters and their JSON Schema.

The decorator reads the function signature once. The five turn fields are
passed by declared name; every other parameter is a run parameter, typed by
its annotation and defaulted by its default value. The schema this module
builds is the `parameters` object of the `register` frame.
"""

from __future__ import annotations

import enum
import inspect
import types
import typing
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import (
    Annotated,
    Any,
    Literal,
    Union,
    get_args,
    get_origin,
)

from pydantic import TypeAdapter, ValidationError
from pydantic_core import to_jsonable_python

TURN_FIELDS = ("messages", "new_messages", "thread_id", "session", "trace_id")
"""The fields the platform sends on every call, in the order the frame lists them."""

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
        declared_type = _type_of_values(list(options))
    if declared_type is None and default is not MISSING:
        declared_type = _JSON_TYPES.get(type(default))
    if declared_type is None:
        declared_type = "string"
    python_type = _PYTHON_TYPES.get(str(declared_type), Any)
    annotation: Any = python_type
    if options:
        try:
            annotation = Literal[tuple(options)]  # type: ignore[valid-type]
        except TypeError:
            # A JSON Schema `enum` can hold objects or arrays, and `Literal`
            # takes hashable values only. The declared type stays, and the
            # membership check against `options` still rejects a value that
            # the list does not hold.
            annotation = python_type
    schema: dict[str, Any] = {"type": declared_type}
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


def analyze_signature(
    func: Callable[..., Any],
    *,
    agent_call_type: type,
    parameters: Mapping[str, Any] | None = None,
) -> AgentSignature:
    """Read the signature once.

    `parameters`, when given, replaces the run parameters read from the
    signature. It is a definition map (`{name: {type, options, default,
    description}}`) or a JSON Schema object with `properties`.
    """
    signature = inspect.signature(func)
    hints = _type_hints(func)
    result = AgentSignature()
    reflected: dict[str, ParameterSpec] = {}

    for index, (name, parameter) in enumerate(signature.parameters.items()):
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
