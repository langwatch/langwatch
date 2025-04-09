import json
from typing import Any, Dict, List, Optional
from langwatch_nlp.studio.types.dsl import (
    Field,
    FieldType,
    LLMConfig,
    NodeDataset,
    NodeRef,
)


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
            return json.dumps(value)
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
    if field.type == FieldType.llm:
        return LLMConfig.model_validate(value)
    if field.type == FieldType.prompting_technique:
        return NodeRef.model_validate(value)
    if field.type == FieldType.dataset:
        return NodeDataset.model_validate(value)
    return value


def autoparse_fields(fields: List[Field], values: Dict[str, Any]) -> Dict[str, Any]:
    parsed_values = {}
    for field in fields:
        if not field.identifier in values:
            continue
        parsed_values[field.identifier] = autoparse_field_value(
            field, values[field.identifier]
        )
    return parsed_values
