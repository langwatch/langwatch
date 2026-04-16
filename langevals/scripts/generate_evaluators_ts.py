import inspect
import json
import os
from typing import Any, Dict, Literal, Optional, Union, get_args, get_origin
from langevals_core.base_evaluator import (
    EvalCategories,
    EvaluationResult,
)

from pydantic import BaseModel
from pydantic_core import PydanticUndefinedType
from langevals.utils import (
    EvaluatorDefinitions,
    get_evaluator_classes,
    get_evaluator_definitions,
    load_evaluator_packages,
)

os.system("npm list -g prettier &> /dev/null || npm install -g prettier")


def stringify_field_types(field_types):
    if len(field_types) == 0:
        return "Record<string, never>"

    settings = "{\n"
    for field_name, field in field_types.items():
        optional = "?" if " | undefined" in field["type"] else ""
        description = (
            field.get("description")
            if not isinstance(field.get("description"), PydanticUndefinedType)
            else None
        )
        default = (
            field.get("default")
            if not isinstance(field.get("default"), PydanticUndefinedType)
            else None
        )
        if description or default or type(default) == bool:
            settings += f"        /**\n"
            description_ = description.replace("\n", ". ") if description else None
            if description_:
                settings += f"        * @description {description_}\n"
            if default or type(default) == bool:
                settings += f"        * @default {json.dumps(default)}\n"
            settings += f"        */\n"
        settings += f"        {field_name}{optional}: {field['type'].replace(' | undefined', '')};\n"
    settings += "      }"

    return settings


def get_field_type_to_zod(field, definitions=None):
    """Convert a Python type annotation to a Zod schema string.
    Uses only APIs compatible with both Zod v3 and v4."""
    if inspect.isclass(field) and issubclass(field, BaseModel):
        inner = stringify_zod_fields(
            {
                field_name: {
                    "annotation": f.annotation,
                    "description": f.description,
                    "default": dump_model_type(f.default),
                    "is_optional": not f.is_required()
                    or get_origin(f.annotation) == Optional
                    or (
                        get_origin(f.annotation) == Union
                        and type(None) in get_args(f.annotation)
                    ),
                }
                for field_name, f in field.model_fields.items()
            },
            definitions,
        )
        return f"z.object({{{inner}}})"
    if field is str:
        return "z.string()"
    elif field is int:
        return "z.number()"
    elif field is float:
        return "z.number()"
    elif field is bool:
        return "z.boolean()"
    elif get_origin(field) is Literal:
        args = get_args(field)
        if len(args) == 1:
            return f"z.literal({json.dumps(args[0])})"
        literals = ", ".join([f"z.literal({json.dumps(v)})" for v in args])
        return f"z.union([{literals}])"
    elif get_origin(field) is Optional:
        inner = get_field_type_to_zod(get_args(field)[0], definitions)
        return f"{inner}.optional()"
    elif get_origin(field) is Union:
        args = [a for a in get_args(field) if a is not type(None)]
        if len(args) == 1:
            # Optional[X] is Union[X, None]
            return f"{get_field_type_to_zod(args[0], definitions)}.optional()"
        parts = ", ".join([get_field_type_to_zod(a, definitions) for a in args])
        return f"z.union([{parts}])"
    elif get_origin(field) is list:
        inner = get_field_type_to_zod(get_args(field)[0], definitions)
        return f"z.array({inner})"
    elif get_origin(field) is dict:
        _, value_type = get_args(field)
        value_zod = get_field_type_to_zod(value_type, definitions)
        return f"z.record(z.string(), {value_zod})"
    elif field is type(None):
        return "z.undefined()"

    evaluator_context = ""
    if definitions:
        evaluator_context = f" on {definitions.category}/{definitions.evaluator_name} settings"
    raise ValueError(
        f"Unsupported field type for Zod conversion: {field}{evaluator_context}"
    )


def stringify_zod_fields(fields, definitions=None):
    """Convert a dict of field info to Zod object properties."""
    parts = []
    for field_name, info in fields.items():
        annotation = info["annotation"]
        description = info.get("description")
        default = info.get("default")
        is_optional = info.get("is_optional", False)

        # Unwrap Optional for the base type
        base_annotation = annotation
        if get_origin(annotation) == Optional:
            base_annotation = get_args(annotation)[0]
        elif get_origin(annotation) == Union and type(None) in get_args(annotation):
            args = [a for a in get_args(annotation) if a != type(None)]
            if len(args) == 1:
                base_annotation = args[0]

        zod_type = get_field_type_to_zod(base_annotation, definitions)

        # Add .describe() if there's a description
        if description and not isinstance(description, PydanticUndefinedType):
            desc_escaped = description.replace("\n", ". ").replace('"', '\\"')
            zod_type += f'.describe("{desc_escaped}")'

        # Add .default() if there's a default value
        if default is not None and not isinstance(default, PydanticUndefinedType):
            zod_type += f".default({json.dumps(default)})"
        elif is_optional and default is None:
            zod_type += ".optional()"

        parts.append(f'    "{field_name}": {zod_type}')

    return "\n" + ",\n".join(parts) + ",\n  "


def dump_model_type(value):
    return (
        value.model_dump()
        if isinstance(value, BaseModel)
        else (
            [dump_model_type(v) for v in value]
            if isinstance(value, list)
            else value
        )
    )


def extract_evaluator_info(definitions: EvaluatorDefinitions) -> Dict[str, Any]:
    evaluator_info = {
        "name": definitions.name,
        "description": definitions.description,
        "category": definitions.category,
        "docsUrl": definitions.docs_url,
        "isGuardrail": definitions.is_guardrail,
        "envVars": definitions.env_vars,
        "settingsTypes": {},
        "settingsDescriptions": {},
        "settingsZodFields": {},
        "result": {},
    }

    def get_field_type_to_typescript(field):
        if inspect.isclass(field) and issubclass(field, BaseModel):
            return stringify_field_types(
                {
                    field_name: {
                        "type": get_field_type_to_typescript(field.annotation),
                        "description": field.description,
                        "default": dump_model_type(field.default),
                    }
                    for field_name, field in field.model_fields.items()
                }
            )
        if field == str:
            return "string"
        elif field == int:
            return "number"
        elif field == float:
            return "number"
        elif field == bool:
            return "boolean"
        elif get_origin(field) == Literal:
            return " | ".join([json.dumps(value) for value in get_args(field)])
        elif get_origin(field) == Optional:
            return get_field_type_to_typescript(get_args(field)[0]) + " | undefined"
        elif get_origin(field) == Union:
            return " | ".join(
                [get_field_type_to_typescript(arg) for arg in get_args(field)]
            )
        elif get_origin(field) == list:
            return get_field_type_to_typescript(get_args(field)[0]) + "[]"
        elif field == type(None):
            return "undefined"

        raise ValueError(
            f"Unsupported field type for typescript conversion: {field} on {definitions.category}/{definitions.evaluator_name} settings"
        )

    for field_name, field in definitions.settings_type.model_fields.items():
        default = dump_model_type(field.default)
        evaluator_info["settingsDescriptions"][field_name] = {
            "description": field.description,
            "default": default,
        }
        evaluator_info["settingsTypes"][field_name] = {
            "type": get_field_type_to_typescript(field.annotation),
            "description": field.description,
            "default": default,
        }

        def is_field_optional(f):
            if not f.is_required():
                return True
            if get_origin(f.annotation) == Optional:
                return True
            if get_origin(f.annotation) == Union and type(None) in get_args(
                f.annotation
            ):
                return True
            return False

        evaluator_info["settingsZodFields"][field_name] = {
            "annotation": field.annotation,
            "description": field.description,
            "default": default,
            "is_optional": is_field_optional(field),
        }

    base_score_description = EvaluationResult.model_fields["score"].description
    score_field = definitions.result_type.model_fields.get("score")
    if (
        score_field
        and score_field.description
        and score_field.description != base_score_description
    ):
        evaluator_info["result"]["score"] = {"description": score_field.description}

    base_passed_description = EvaluationResult.model_fields["passed"].description
    passed_field = definitions.result_type.model_fields.get("passed")
    if (
        passed_field
        and passed_field.description
        and passed_field.description != base_passed_description
    ):
        evaluator_info["result"]["passed"] = {"description": passed_field.description}

    base_label_description = EvaluationResult.model_fields["label"].description
    label_field = definitions.result_type.model_fields.get("label")
    if (
        label_field
        and label_field.description
        and label_field.description != base_label_description
    ):
        evaluator_info["result"]["label"] = {"description": label_field.description}

    def is_field_optional(field):
        if not field.is_required():
            return True
        if get_origin(field.annotation) == Optional:
            return True
        if get_origin(field.annotation) == Union and type(None) in get_args(
            field.annotation
        ):
            return True
        return False

    evaluator_info["requiredFields"] = [
        field_name
        for field_name, field in definitions.entry_type.model_fields.items()
        if not is_field_optional(field)
    ]
    evaluator_info["optionalFields"] = [
        field_name
        for field_name, field in definitions.entry_type.model_fields.items()
        if is_field_optional(field)
    ]

    return evaluator_info


def generate_typescript_definitions(evaluators_info: Dict[str, Dict[str, Any]]) -> str:
    categories_union = " | ".join([f'"{value}"' for value in get_args(EvalCategories)])

    # Start with Zod import
    ts_definitions = 'import { z } from "zod";\n\n'

    # Zod schemas for result types
    ts_definitions += (
        "export const moneySchema = z.object({\n"
        "  currency: z.string(),\n"
        "  amount: z.number(),\n"
        "});\n\n"
    )

    ts_definitions += (
        "export const evaluationResultSkippedSchema = z.object({\n"
        '  status: z.literal("skipped"),\n'
        "  details: z.union([z.string(), z.undefined()]).optional(),\n"
        "});\n\n"
    )

    ts_definitions += (
        "export const evaluationResultErrorSchema = z.object({\n"
        '  status: z.literal("error"),\n'
        "  error_type: z.string(),\n"
        "  details: z.string(),\n"
        "  traceback: z.array(z.string()),\n"
        "});\n\n"
    )

    ts_definitions += (
        "export const evaluationResultSchema = z.object({\n"
        '  status: z.literal("processed"),\n'
        "  score: z.union([z.number(), z.undefined()]).optional(),\n"
        "  passed: z.union([z.boolean(), z.undefined()]).optional(),\n"
        "  label: z.union([z.string(), z.undefined()]).optional(),\n"
        "  details: z.union([z.string(), z.undefined()]).optional(),\n"
        "  cost: z.union([moneySchema, z.undefined()]).optional(),\n"
        "  raw_response: z.any().optional(),\n"
        "});\n\n"
    )

    ts_definitions += (
        "export const singleEvaluationResultSchema = z.union([\n"
        "  evaluationResultSchema,\n"
        "  evaluationResultSkippedSchema,\n"
        "  evaluationResultErrorSchema,\n"
        "]);\n\n"
    )

    # evaluatorsSchema — Zod schema is the source of truth
    ts_definitions += "export const evaluatorsSchema = z.object({\n"
    for evaluator_name, evaluator_info in evaluators_info.items():
        zod_fields = evaluator_info.get("settingsZodFields", {})
        if len(zod_fields) == 0:
            # Strict so unknown keys are rejected (matches typed evaluators).
            # Currently no evaluator hits this branch, but this prevents silent
            # key-stripping if one is added later.
            settings_zod = "z.object({}).strict()"
        else:
            inner = stringify_zod_fields(zod_fields)
            settings_zod = f"z.object({{{inner}}})"
        ts_definitions += f'  "{evaluator_name}": z.object({{\n'
        ts_definitions += f"    settings: {settings_zod},\n"
        ts_definitions += "  }),\n"
    ts_definitions += "});\n\n"

    ts_definitions += (
        "export const batchEvaluationResultSchema = z.array(\n"
        "  singleEvaluationResultSchema,\n"
        ");\n\n"
    )

    # Plain types (kept for compile-time use)
    ts_definitions += (
        f"export type EvaluatorDefinition<T extends EvaluatorTypes> = {{\n"
        f"    name: string;\n"
        f"    description: string;\n"
        f"    category: {categories_union};\n"
        f"    docsUrl?: string;\n"
        f"    isGuardrail: boolean;\n"
        f'    requiredFields: ("input" | "output" | "contexts" | "expected_output" | "expected_contexts" | "conversation")[];\n'
        f'    optionalFields: ("input" | "output" | "contexts" | "expected_output" | "expected_contexts" | "conversation")[];\n'
        f"    settings: {{\n"
        f'        [K in keyof Evaluators[T]["settings"]]: {{\n'
        f"        description?: string;\n"
        f'        default: Evaluators[T]["settings"][K];\n'
        f"        }};\n"
        f"    }};\n"
        f"    envVars: string[];\n"
        f"    result: {{\n"
        f"        score?: {{\n"
        f"        description: string;\n"
        f"        }};\n"
        f"        passed?: {{\n"
        f"        description: string;\n"
        f"        }};\n"
        f"        label?: {{\n"
        f"        description: string;\n"
        f"        }};\n"
        f"    }};\n"
        f"}};\n\n"
        f"export type EvaluatorTypes = keyof Evaluators;\n\n"
        f"export type EvaluationResult = z.infer<typeof evaluationResultSchema>;\n\n"
        f"export type EvaluationResultSkipped = z.infer<typeof evaluationResultSkippedSchema>;\n\n"
        f"export type EvaluationResultError = z.infer<typeof evaluationResultErrorSchema>;\n\n"
        f"export type SingleEvaluationResult = EvaluationResult | EvaluationResultSkipped | EvaluationResultError;\n"
        f"export type BatchEvaluationResult = SingleEvaluationResult[];\n\n"
        f"export type Money = z.infer<typeof moneySchema>;\n\n"
    )

    ts_definitions += "export type Evaluators = z.infer<typeof evaluatorsSchema>;\n\n"

    ts_definitions += "export const AVAILABLE_EVALUATORS: {\n"
    ts_definitions += "  [K in EvaluatorTypes]: EvaluatorDefinition<K>;\n"
    ts_definitions += "} = {\n"
    for evaluator_name, evaluator_info in evaluators_info.items():
        ts_definitions += f'  "{evaluator_name}": {{\n'
        ts_definitions += f'    name: `{evaluator_info["name"]}`,\n'
        ts_definitions += f'    description: `{evaluator_info["description"]}`,\n'
        ts_definitions += f'    category: "{evaluator_info["category"]}",\n'
        ts_definitions += f'    docsUrl: "{evaluator_info["docsUrl"]}",\n'
        ts_definitions += (
            f'    isGuardrail: {str(evaluator_info["isGuardrail"]).lower()},\n'
        )
        ts_definitions += (
            f'    requiredFields: {json.dumps(evaluator_info["requiredFields"])},\n'
        )
        ts_definitions += (
            f'    optionalFields: {json.dumps(evaluator_info["optionalFields"])},\n'
        )
        ts_definitions += f'    settings: {json.dumps(evaluator_info["settingsDescriptions"], indent=6).replace(": null", ": undefined")},\n'
        ts_definitions += f'    envVars: {json.dumps(evaluator_info["envVars"])},\n'
        ts_definitions += (
            f'    result: {json.dumps(evaluator_info["result"], indent=6)}\n'
        )
        ts_definitions += "  },\n"
    ts_definitions += "};\n"

    return ts_definitions


def main():
    evaluators = load_evaluator_packages()
    evaluators_info = {}

    for _, evaluator_module in evaluators.items():
        for evaluator_cls in get_evaluator_classes(evaluator_module):
            definitions = get_evaluator_definitions(evaluator_cls)
            evaluator_info = extract_evaluator_info(definitions)
            evaluators_info[
                f"{definitions.module_name}/{definitions.evaluator_name}"
            ] = evaluator_info

    ts_content = generate_typescript_definitions(evaluators_info)

    with open("ts-integration/evaluators.generated.ts", "w") as ts_file:
        ts_file.write(ts_content)

    os.system("prettier ts-integration/evaluators.generated.ts --write &> /dev/null")

    print("TypeScript definitions generated successfully.")


if __name__ == "__main__":
    main()
