import inspect
import json
import os
from typing import Any, Dict, Literal, Union, get_args, get_origin
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


# ---------------------------------------------------------------------------
# Zod emission. Each evaluator's settings model is rendered directly as a Zod
# schema (the source of truth); the TypeScript types are inferred downstream
# with z.infer. This replaces the old TypeScript-types-then-ts-to-zod pipeline.
# ---------------------------------------------------------------------------


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


def field_annotation_to_zod(annotation) -> str:
    """Render a pydantic annotation as a Zod base schema (without modifiers)."""
    if inspect.isclass(annotation) and issubclass(annotation, BaseModel):
        fields = [
            f"{json.dumps(name)}: {field_to_zod(field)}"
            for name, field in annotation.model_fields.items()
        ]
        return "z.object({" + ", ".join(fields) + "})"
    if annotation is str:
        return "z.string()"
    if annotation is int or annotation is float:
        return "z.number()"
    if annotation is bool:
        return "z.boolean()"

    origin = get_origin(annotation)
    if origin is Literal:
        literals = [f"z.literal({json.dumps(value)})" for value in get_args(annotation)]
        return literals[0] if len(literals) == 1 else "z.union([" + ", ".join(literals) + "])"
    if origin is Union:
        members = [arg for arg in get_args(annotation) if arg is not type(None)]
        zods = [field_annotation_to_zod(arg) for arg in members]
        return zods[0] if len(zods) == 1 else "z.union([" + ", ".join(zods) + "])"
    if origin is list:
        return f"z.array({field_annotation_to_zod(get_args(annotation)[0])})"
    if annotation is type(None):
        return "z.undefined()"

    raise ValueError(f"Unsupported field annotation for zod conversion: {annotation}")


def field_to_zod(field) -> str:
    """Render a pydantic FieldInfo as a Zod schema with optional/describe/default."""
    base = field_annotation_to_zod(field.annotation)
    has_default = not isinstance(field.default, PydanticUndefinedType)
    default_value = dump_model_type(field.default) if has_default else None
    # A falsy non-boolean default (None / empty) carries no explicit value to
    # surface; booleans (including False) are always surfaced. This mirrors how
    # the AVAILABLE_EVALUATORS catalog reports settings defaults.
    emit_default = has_default and (bool(default_value) or isinstance(default_value, bool))
    is_optional = (
        get_origin(field.annotation) is Union
        and type(None) in get_args(field.annotation)
    )
    description = (
        field.description
        if not isinstance(field.description, PydanticUndefinedType)
        else None
    )

    out = base
    if is_optional and not emit_default:
        out += ".optional()"
    if description:
        out += f".describe({json.dumps(description.replace(chr(10), '. '))})"
    if emit_default:
        out += f".default({json.dumps(default_value)})"
    return out


def settings_to_zod(settings_type) -> str:
    fields = settings_type.model_fields
    if len(fields) == 0:
        # Empty settings: an object with no allowed keys.
        return "z.record(z.string(), z.never())"
    parts = [f"{json.dumps(name)}: {field_to_zod(field)}" for name, field in fields.items()]
    return "z.object({" + ", ".join(parts) + "})"


def extract_evaluator_info(definitions: EvaluatorDefinitions) -> Dict[str, Any]:
    evaluator_info = {
        "name": definitions.name,
        "description": definitions.description,
        "category": definitions.category,
        "docsUrl": definitions.docs_url,
        "isGuardrail": definitions.is_guardrail,
        "envVars": definitions.env_vars,
        "zodSettings": settings_to_zod(definitions.settings_type),
        "settingsDescriptions": {},
        "result": {},
    }

    for field_name, field in definitions.settings_type.model_fields.items():
        evaluator_info["settingsDescriptions"][field_name] = {
            "description": field.description,
            "default": dump_model_type(field.default),
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
        if not field.is_required:
            return True
        if get_origin(field.annotation) is Union and type(None) in get_args(
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


# Fixed result schemas mirroring langevals_core.base_evaluator. These shapes are
# stable, so they are emitted verbatim rather than reflected.
RESULT_SCHEMAS = """export const moneySchema = z.object({
  currency: z.string(),
  amount: z.number(),
});

export const evaluationResultSchema = z.object({
  status: z.literal("processed"),
  score: z.number().optional(),
  passed: z.boolean().optional(),
  label: z.string().optional(),
  details: z.string().optional(),
  cost: moneySchema.optional(),
  raw_response: z.any().optional(),
});

export const evaluationResultSkippedSchema = z.object({
  status: z.literal("skipped"),
  details: z.string().optional(),
});

export const evaluationResultErrorSchema = z.object({
  status: z.literal("error"),
  error_type: z.string(),
  details: z.string(),
  traceback: z.array(z.string()),
});

export const singleEvaluationResultSchema = z.union([
  evaluationResultSchema,
  evaluationResultSkippedSchema,
  evaluationResultErrorSchema,
]);

export const batchEvaluationResultSchema = z.array(singleEvaluationResultSchema);
"""

INFERRED_TYPES = """export type Money = z.infer<typeof moneySchema>;
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export type EvaluationResultSkipped = z.infer<typeof evaluationResultSkippedSchema>;
export type EvaluationResultError = z.infer<typeof evaluationResultErrorSchema>;
export type SingleEvaluationResult = z.infer<typeof singleEvaluationResultSchema>;
export type BatchEvaluationResult = z.infer<typeof batchEvaluationResultSchema>;
export type Evaluators = z.infer<typeof evaluatorsSchema>;
export type EvaluatorTypes = keyof Evaluators;
"""


def generate_evaluator_definition_type() -> str:
    categories_union = " | ".join([f'"{value}"' for value in get_args(EvalCategories)])
    return (
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
        f"}};\n"
    )


def generate_definitions(evaluators_info: Dict[str, Dict[str, Any]]) -> str:
    out = (
        "// Generated from langevals (see langevals/scripts/generate_evaluators_ts.py).\n"
        "// Zod-first: the schemas below are the source of truth and the TypeScript types\n"
        "// are inferred with z.infer. Do not edit by hand.\n"
        'import { z } from "zod";\n\n'
    )

    # evaluatorTypesSchema: a string identifier. Catalog keys and `custom/*` keys
    # (created at runtime) must both validate, so it stays a free-form string.
    out += "export const evaluatorTypesSchema = z.string();\n\n"

    out += RESULT_SCHEMAS + "\n"

    out += "export const evaluatorsSchema = z.object({\n"
    for evaluator_name, evaluator_info in evaluators_info.items():
        out += f"  {json.dumps(evaluator_name)}: z.object({{ settings: {evaluator_info['zodSettings']} }}),\n"
    out += "});\n\n"

    out += INFERRED_TYPES + "\n"

    out += generate_evaluator_definition_type() + "\n"

    out += "export const AVAILABLE_EVALUATORS: {\n"
    out += "  [K in EvaluatorTypes]: EvaluatorDefinition<K>;\n"
    out += "} = {\n"
    for evaluator_name, evaluator_info in evaluators_info.items():
        out += f'  "{evaluator_name}": {{\n'
        out += f'    name: `{evaluator_info["name"]}`,\n'
        out += f'    description: `{evaluator_info["description"]}`,\n'
        out += f'    category: "{evaluator_info["category"]}",\n'
        out += f'    docsUrl: "{evaluator_info["docsUrl"]}",\n'
        out += f'    isGuardrail: {str(evaluator_info["isGuardrail"]).lower()},\n'
        out += f'    requiredFields: {json.dumps(evaluator_info["requiredFields"])},\n'
        out += f'    optionalFields: {json.dumps(evaluator_info["optionalFields"])},\n'
        out += f'    settings: {json.dumps(evaluator_info["settingsDescriptions"], indent=6).replace(": null", ": undefined")},\n'
        out += f'    envVars: {json.dumps(evaluator_info["envVars"])},\n'
        out += f'    result: {json.dumps(evaluator_info["result"], indent=6)}\n'
        out += "  },\n"
    out += "};\n"

    return out


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

    ts_content = generate_definitions(evaluators_info)

    with open("ts-integration/evaluators.generated.ts", "w") as ts_file:
        ts_file.write(ts_content)

    os.system("prettier ts-integration/evaluators.generated.ts --write &> /dev/null")

    print("Zod evaluator schemas generated successfully.")


if __name__ == "__main__":
    main()
