import json
from typing import Any, Callable, Dict, List, Optional, TypeVar
from langwatch_nlp.studio.types.dsl import (
    Field,
    FieldType,
    LLMConfig,
    NodeDataset,
    NodeRef,
)
import dspy
from pydantic import BaseModel
from langwatch_nlp.studio.utils import SerializableWithPydanticAndPredictEncoder


def parse_fields(fields: List[Field], autoparse=True) -> Dict[str, Any]:
    return {
        field.identifier: (
            autoparse_field_value(field, field.value) if autoparse else field.value
        )
        for field in fields
        if field.value is not None
    }


def autoparse_field_value(field: Field, value: Optional[Any]) -> Optional[Any]:
    if type(value) == str and (
        value.startswith("{") or value.startswith("[") or value.startswith('"')
    ):
        try:
            value = json.loads(value)
        except ValueError:
            pass
    if value is None or value == "null" or value == "None":
        return None

    if field.type == FieldType.int:
        return int(value)
    if field.type == FieldType.float:
        return float(value)
    if field.type == FieldType.bool:
        return bool(value)
    if field.type == FieldType.str:
        if type(value) == str:
            return value
        try:
            return json.dumps(value, cls=SerializableWithPydanticAndPredictEncoder, ensure_ascii=False)
        except Exception:
            if isinstance(value, object):
                return repr(value)
            return str(value)
    if field.type == FieldType.list_str:
        if isinstance(value, list):
            return [
                autoparse_field_value(
                    Field(identifier=field.identifier, type=FieldType.str), item
                )
                for item in value
            ]
        return [
            autoparse_field_value(
                Field(identifier=field.identifier, type=FieldType.str), value
            )
        ]
    if field.type == FieldType.dict and isinstance(value, BaseModel):
        return json.loads(
            json.dumps(
                value.model_dump(), cls=SerializableWithPydanticAndPredictEncoder, ensure_ascii=False
            )
        )
    if field.type == FieldType.llm:
        return LLMConfig.model_validate(value)
    if field.type == FieldType.prompting_technique:
        return NodeRef.model_validate(value)
    if field.type == FieldType.dataset:
        return NodeDataset.model_validate(value)
    if field.type == FieldType.image:
        return dspy.Image.from_url(value)
    return value


def _coerce_chat_messages_input(value: Any) -> Any:
    """
    Convert a chat_messages-typed signature INPUT value into a `dspy.History` instance.

    Signature inputs typed `chat_messages` are annotated as `dspy.History` on the generated
    signature class (see FIELD_TYPE_TO_DSPY_TYPE). The runtime value arriving from the
    serialized adapter is typically a list of `{role, content}` dicts (or a JSON-stringified
    form thereof); coerce it so DSPy's ChatAdapter renders distinct conversation turns
    instead of collapsing them into one escaped-JSON blob. Applied only on the inputs path
    (signature parameters retain raw list[dict] shape for prompt-template iteration).
    """
    if isinstance(value, dspy.History):
        return value
    if isinstance(value, list):
        return dspy.History(messages=value)
    if isinstance(value, dict):
        return dspy.History(messages=[value])
    return value


def autoparse_fields(fields: List[Field], values: Dict[str, Any]) -> Dict[str, Any]:
    parsed_values = {}
    for field in fields:
        if not field.identifier in values:
            continue
        parsed = autoparse_field_value(field, values[field.identifier])
        if field.type == FieldType.chat_messages:
            parsed = _coerce_chat_messages_input(parsed)
        parsed_values[field.identifier] = parsed
    return parsed_values


T = TypeVar("T", bound=dspy.Module)


def with_autoparsing(module: type[T]) -> type[T]:
    # If already patched, repatch so new config can be picked up
    if hasattr(module, "__forward_before_autoparsing__"):
        module.forward = module.__forward_before_autoparsing__  # type: ignore
    module.__forward_before_autoparsing__ = module.forward  # type: ignore

    import inspect
    from typing import get_type_hints, get_origin, get_args, List, Optional

    def get_field_type_from_annotation(annotation):
        # Handle Optional types
        if get_origin(annotation) is Optional:
            annotation = get_args(annotation)[0]  # Get the inner type

        # Handle List types
        if get_origin(annotation) is list or get_origin(annotation) is List:
            inner_type = get_args(annotation)[0]
            if inner_type is str:
                return FieldType.list_str

        # Handle basic types
        if annotation is int:
            return FieldType.int
        elif annotation is float:
            return FieldType.float
        elif annotation is bool:
            return FieldType.bool
        elif annotation is str:
            return FieldType.str
        elif (
            annotation is dict
            or str(annotation).startswith("dict[")
            or str(annotation).startswith("Dict[")
        ):
            return FieldType.dict
        elif (
            annotation is list
            or str(annotation).startswith("list[")
            or str(annotation).startswith("List[")
        ):
            return FieldType.list
        elif annotation is dspy.Image:
            return FieldType.image
        elif annotation is dspy.History:
            return FieldType.chat_messages

        return None  # Default to no type conversion

    def forward_with_autoparsing(instance_self, *args, **kwargs):
        forward = module.__forward_before_autoparsing__  # type: ignore

        try:
            forward_sig = module._forward_signature if hasattr(module, "_forward_signature") else forward  # type: ignore
            sig = inspect.signature(forward_sig)
            type_hints = get_type_hints(forward_sig)
        except Exception:
            return forward(instance_self, *args, **kwargs)

        def _coerce(field_type, value):
            parsed = autoparse_field_value(
                Field(identifier="_", type=field_type), value
            )
            if field_type == FieldType.chat_messages:
                parsed = _coerce_chat_messages_input(parsed)
            return parsed

        # Process positional arguments
        parsed_args = []
        for i, (param_name, param) in enumerate(list(sig.parameters.items())):
            if i < len(args):  # If we have a positional argument for this parameter
                if param_name in type_hints:
                    field_type = get_field_type_from_annotation(type_hints[param_name])
                    if field_type is not None:
                        parsed_args.append(_coerce(field_type, args[i]))
                    else:
                        parsed_args.append(args[i])
                else:
                    parsed_args.append(args[i])

        # Process keyword arguments
        parsed_kwargs = {}
        for key, value in kwargs.items():
            if key in type_hints:
                field_type = get_field_type_from_annotation(type_hints[key])
                if field_type is not None:
                    parsed_kwargs[key] = _coerce(field_type, value)
                else:
                    parsed_kwargs[key] = value
            else:
                parsed_kwargs[key] = value

        return forward(instance_self, *parsed_args, **parsed_kwargs)

    module.forward = forward_with_autoparsing  # type: ignore
    return module
