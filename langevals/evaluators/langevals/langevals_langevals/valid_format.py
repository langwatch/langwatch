import ast
import json
from typing import Literal, Optional, Dict, Any
from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResultSkipped,
    EvaluatorEntry,
    EvaluationResult,
    EvaluatorSettings,
    SingleEvaluationResult,
    EvaluationResultError,
)
import markdown
from pydantic import Field
from jsonschema import validate, ValidationError
import sqlglot


class ValidFormatSettings(EvaluatorSettings):
    format: Literal["json", "markdown", "python", "sql"] = "json"
    json_schema: Optional[str] = Field(
        default=None,
        description="JSON schema to validate against when format is 'json'",
    )


class ValidFormatResult(EvaluationResult):
    passed: Optional[bool] = Field(
        default=True,
        description="True if the output is formatted correctly, False otherwise",
    )


class ValidFormatEntry(EvaluatorEntry):
    output: Optional[str] = None


class ValidFormatEvaluator(
    BaseEvaluator[ValidFormatEntry, ValidFormatSettings, ValidFormatResult]
):
    """
    Allows you to check if the output is a valid json, markdown, python, sql, etc.
    For JSON, can optionally validate against a provided schema.
    """

    name = "Valid Format Evaluator"
    category = "quality"
    default_settings = ValidFormatSettings()
    is_guardrail = True

    def evaluate(self, entry: ValidFormatEntry) -> SingleEvaluationResult:
        if not entry.output:
            return EvaluationResultSkipped(details="Output is empty")

        if self.settings.format == "json":
            try:
                parsed_json = json.loads(entry.output)
                if self.settings.json_schema:
                    try:
                        json_schema = json.loads(self.settings.json_schema)
                    except Exception as e:
                        return EvaluationResultError(
                            details=f"Invalid JSON Schema: {e}",
                            error_type="json_schema_error",
                            traceback=[],
                        )
                    try:
                        validate(
                            instance=parsed_json,
                            schema=json_schema,
                        )
                    except ValidationError as e:
                        return ValidFormatResult(
                            score=0,
                            passed=False,
                            details=f"JSON Schema validation failed: {e}",
                        )
            except json.JSONDecodeError as e:
                return ValidFormatResult(
                    score=0, passed=False, details=f"Invalid JSON: {e}"
                )
        elif self.settings.format == "markdown":
            try:
                html_result = markdown.markdown(entry.output)
                # Check if the HTML output is different from plain text
                # If they're the same, no markdown elements were processed
                plain_text = entry.output.replace("\n", "").strip()
                html_without_p = (
                    html_result.replace("<p>", "")
                    .replace("</p>", "")
                    .replace("\n", "")
                    .strip()
                )
                if plain_text == html_without_p:
                    return ValidFormatResult(
                        passed=False,
                        details="No markdown elements found. Text should contain markdown formatting like headers (#), bold (**), lists, etc.",
                    )
            except Exception as e:
                return ValidFormatResult(
                    score=0, passed=False, details=f"Invalid Markdown: {e}"
                )
        elif self.settings.format == "python":
            try:
                ast.parse(entry.output)
            except Exception as e:
                return ValidFormatResult(
                    score=0, passed=False, details=f"Invalid Python: {e}"
                )
        elif self.settings.format == "sql":
            try:
                try:
                    json.loads(entry.output)
                    return ValidFormatResult(
                        passed=False,
                        details="Invalid SQL: Detected JSON instead of SQL string",
                    )
                except Exception:
                    sqlglot.parse(entry.output)
            except Exception as e:
                return ValidFormatResult(
                    score=0, passed=False, details=f"Invalid SQL: {e}"
                )

        return ValidFormatResult(score=1, passed=True)
