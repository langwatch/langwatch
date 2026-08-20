#!/usr/bin/env python3
"""
Python script to generate OpenAPI JSON from evaluators.generated.ts
"""

import json
import re
import sys
from pathlib import Path
from typing import Dict, Any, List, Optional


def parse_typescript_evaluators(file_path: str) -> Dict[str, Any]:
    """
    Parse the TypeScript evaluators file to extract evaluator definitions.
    """
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    evaluators = {}

    # Find the AVAILABLE_EVALUATORS object using a more robust approach
    # First find the start of the object
    start_pattern = r"export const AVAILABLE_EVALUATORS:\s*{[^}]*}\s*=\s*{"
    start_match = re.search(start_pattern, content)

    if not start_match:
        print("Could not find AVAILABLE_EVALUATORS object")
        return evaluators

    start_pos = start_match.end() - 1  # Position of the opening brace

    # Find the matching closing brace
    brace_count = 0
    end_pos = start_pos

    for j, char in enumerate(content[start_pos:], start_pos):
        if char == "{":
            brace_count += 1
        elif char == "}":
            brace_count -= 1
            if brace_count == 0:
                end_pos = j + 1
                break

    evaluators_content = content[start_pos:end_pos]

    # Find all evaluator definitions using regex
    # Look for patterns like "evaluator/id": { ... }
    evaluator_pattern = r'"([^"]+)":\s*{'

    # Find all matches
    matches = list(re.finditer(evaluator_pattern, evaluators_content))
    print(f"Found {len(matches)} evaluator matches")

    for i, match in enumerate(matches):
        evaluator_id = match.group(1)
        start_pos = match.end() - 1  # Position of the opening brace

        # Find the matching closing brace
        brace_count = 0
        end_pos = start_pos

        for j, char in enumerate(evaluators_content[start_pos:], start_pos):
            if char == "{":
                brace_count += 1
            elif char == "}":
                brace_count -= 1
                if brace_count == 0:
                    end_pos = j + 1
                    break

        evaluator_content = evaluators_content[start_pos:end_pos]

        # Parse the evaluator content
        evaluator = parse_evaluator_content(evaluator_id, evaluator_content)
        evaluators[evaluator_id] = evaluator

        print(f"Processing evaluator: {evaluator_id}")

    return evaluators


def parse_evaluator_content(evaluator_id: str, content: str) -> Dict[str, Any]:
    """Parse individual evaluator content."""

    evaluator = {
        "name": evaluator_id,
        "description": "",
        "category": "other",
        "isGuardrail": False,
        "requiredFields": [],
        "optionalFields": [],
        "settings": {},
    }

    # Extract name
    name_match = re.search(r"name:\s*`([^`]+)`", content, re.DOTALL)
    if name_match:
        evaluator["name"] = name_match.group(1).strip()

    # Extract description
    desc_match = re.search(r"description:\s*`([^`]+)`", content, re.DOTALL)
    if desc_match:
        evaluator["description"] = desc_match.group(1).strip()

    # Extract category
    cat_match = re.search(r'category:\s*"([^"]+)"', content)
    if cat_match:
        evaluator["category"] = cat_match.group(1)

    # Extract isGuardrail
    guard_match = re.search(r"isGuardrail:\s*(true|false)", content)
    if guard_match:
        evaluator["isGuardrail"] = guard_match.group(1) == "true"

    # Extract required fields
    req_match = re.search(r"requiredFields:\s*\[([^\]]*)\]", content)
    if req_match:
        req_content = req_match.group(1)
        evaluator["requiredFields"] = [
            field.strip().strip('"') for field in re.findall(r'"([^"]+)"', req_content)
        ]

    # Extract optional fields
    opt_match = re.search(r"optionalFields:\s*\[([^\]]*)\]", content)
    if opt_match:
        opt_content = opt_match.group(1)
        evaluator["optionalFields"] = [
            field.strip().strip('"') for field in re.findall(r'"([^"]+)"', opt_content)
        ]

    # Extract settings using a more robust approach
    settings_start = content.find("settings:")
    if settings_start != -1:
        # Find the opening brace after settings:
        brace_start = content.find("{", settings_start)
        if brace_start != -1:
            # Find the matching closing brace
            brace_count = 0
            settings_end = brace_start

            for i, char in enumerate(content[brace_start:], brace_start):
                if char == "{":
                    brace_count += 1
                elif char == "}":
                    brace_count -= 1
                    if brace_count == 0:
                        settings_end = i + 1
                        break

            settings_content = content[brace_start + 1 : settings_end - 1]
            evaluator["settings"] = parse_settings(settings_content)
        else:
            print(f"DEBUG: No opening brace found for settings in {evaluator_id}")
    else:
        print(f"DEBUG: No settings found for {evaluator_id}")

    return evaluator


def parse_settings(settings_content: str) -> Dict[str, Any]:
    """Parse settings object."""
    settings = {}

    # Find all setting definitions using a more robust approach
    # Look for patterns like "setting_name: { ... }" with proper brace matching
    setting_pattern = r"(\w+):\s*{"

    for setting_match in re.finditer(setting_pattern, settings_content, re.DOTALL):
        setting_name = setting_match.group(1)
        start_pos = setting_match.end() - 1  # Position of the opening brace

        # Find the matching closing brace
        brace_count = 0
        end_pos = start_pos

        for i, char in enumerate(settings_content[start_pos:], start_pos):
            if char == "{":
                brace_count += 1
            elif char == "}":
                brace_count -= 1
                if brace_count == 0:
                    end_pos = i + 1
                    break

        setting_content = settings_content[start_pos + 1 : end_pos - 1]

        # Extract description
        desc_match = re.search(r'description:\s*"([^"]+)"', setting_content)
        description = desc_match.group(1) if desc_match else f"{setting_name} setting"

        # Extract default value
        default_value = extract_default_value(setting_content)

        settings[setting_name] = {"description": description, "default": default_value}

    return settings


def typescript_to_json(ts_str: str) -> str:
    """Convert a TypeScript-style object/array string to valid JSON."""
    # Remove newlines and excessive spaces for easier regex
    s = ts_str.strip()
    # Remove trailing commas before closing brackets/braces
    s = re.sub(r",\s*([}\]])", r"\1", s)
    # Quote property names (unquoted keys)
    s = re.sub(r"([,{]\s*)([A-Za-z0-9_]+)\s*:", r'\1"\2":', s)
    # Quote string values (only those not already quoted)
    s = re.sub(r":\s*([A-Za-z0-9_\-/\.]+)", r': "\1"', s)
    # Replace single quotes with double quotes
    s = s.replace("'", '"')
    return s


def extract_default_value(content: str) -> Any:
    """Extract default value from setting content."""

    # Look for default: followed by various value types
    # Use a more robust pattern that handles arrays and objects
    default_match = re.search(r"default:\s*(.+?)(?:,|$)", content, re.DOTALL)
    if not default_match:
        return None

    value_str = default_match.group(1).strip()

    # If it's an array or object, try to find the complete value
    if value_str.startswith("[") or value_str.startswith("{"):
        # Find the position of the opening bracket in the original content
        default_start = content.find("default:")
        if default_start != -1:
            bracket_start = -1
            if value_str.startswith("["):
                bracket_start = content.find("[", default_start)
            elif value_str.startswith("{"):
                bracket_start = content.find("{", default_start)

            if bracket_start != -1:
                # Find the matching closing bracket
                bracket_count = 0
                complete_value = ""
                open_char = content[bracket_start]
                close_char = "]" if open_char == "[" else "}"

                for i, char in enumerate(content[bracket_start:], bracket_start):
                    complete_value += char
                    if char == open_char:
                        bracket_count += 1
                    elif char == close_char:
                        bracket_count -= 1
                        if bracket_count == 0:
                            break

                value_str = complete_value

    # Handle different value types
    if value_str.startswith('"') and value_str.endswith('"'):
        # String value
        return value_str[1:-1]
    elif value_str.startswith("`") and value_str.endswith("`"):
        # Backtick string
        return value_str[1:-1]
    elif value_str == "true":
        return True
    elif value_str == "false":
        return False
    elif value_str.isdigit():
        return int(value_str)
    elif value_str.replace(".", "").isdigit():
        return float(value_str)
    elif value_str.startswith("[") and value_str.endswith("]"):
        # Array value - try to parse as JSON
        try:
            return json.loads(value_str)
        except:
            # Try to convert TypeScript array to JSON
            try:
                json_str = typescript_to_json(value_str)
                return json.loads(json_str)
            except:
                return []
    elif value_str.startswith("{") and value_str.endswith("}"):
        # Object value - try to parse as JSON
        try:
            return json.loads(value_str)
        except:
            # Try to convert TypeScript object to JSON
            try:
                json_str = typescript_to_json(value_str)
                return json.loads(json_str)
            except:
                return {}
    else:
        return value_str


def generate_openapi_schema(evaluators: Dict[str, Any]) -> Dict[str, Any]:
    """Generate OpenAPI 3.1.0 schema from evaluators."""

    schema = {
        "openapi": "3.1.0",
        "info": {
            "title": "LangEvals API",
            "version": "1.0.0",
            "description": "API for LangEvals evaluators",
        },
        "servers": [
            {
                "url": "https://app.langwatch.ai/api/evaluations",
                "description": "Production server",
            }
        ],
        "security": [{"api_key": []}],
        "paths": {},
        "components": {
            "schemas": {
                "EvaluationRequest": {
                    "type": "object",
                    "properties": {
                        "data": {
                            "type": "object",
                            "properties": {
                                "input": {
                                    "type": "string",
                                    "description": "The input text to evaluate",
                                },
                                "output": {
                                    "type": "string",
                                    "description": "The output text to evaluate",
                                },
                                "contexts": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Context information for evaluation",
                                },
                                "expected_output": {
                                    "type": "string",
                                    "description": "Expected output for comparison",
                                },
                                "expected_contexts": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Expected context information",
                                },
                                "conversation": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "role": {
                                                "type": "string",
                                                "enum": ["user", "assistant", "system"],
                                            },
                                            "content": {"type": "string"},
                                        },
                                        "required": ["role", "content"],
                                    },
                                    "description": "Conversation history",
                                },
                            },
                        },
                        "settings": {
                            "type": "object",
                            "description": "Evaluator settings",
                        },
                    },
                    "required": ["data"],
                },
                "EvaluationEntry": {
                    "type": "object",
                    "properties": {
                        "input": {
                            "type": "string",
                            "description": "The input text to evaluate",
                        },
                        "output": {
                            "type": "string",
                            "description": "The output text to evaluate",
                        },
                        "contexts": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Context information for evaluation",
                        },
                        "expected_output": {
                            "type": "string",
                            "description": "Expected output for comparison",
                        },
                        "expected_contexts": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Expected context information",
                        },
                        "conversation": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "role": {
                                        "type": "string",
                                        "enum": ["user", "assistant", "system"],
                                    },
                                    "content": {"type": "string"},
                                },
                                "required": ["role", "content"],
                            },
                            "description": "Conversation history",
                        },
                    },
                },
                "EvaluationResult": {
                    "type": "object",
                    "properties": {
                        "status": {
                            "type": "string",
                            "enum": ["processed", "skipped", "error"],
                        },
                        "score": {"type": "number", "description": "Evaluation score"},
                        "passed": {
                            "type": "boolean",
                            "description": "Whether the evaluation passed",
                        },
                        "label": {"type": "string", "description": "Evaluation label"},
                        "details": {
                            "type": "string",
                            "description": "Additional details about the evaluation",
                        },
                        "cost": {"$ref": "#/components/schemas/Money"},
                        "raw_response": {
                            "type": "object",
                            "description": "Raw response from the evaluator",
                        },
                        "error_type": {
                            "type": "string",
                            "description": "Type of error if status is 'error'",
                        },
                        "traceback": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Error traceback if status is 'error'",
                        },
                    },
                    "required": ["status"],
                },
                "Money": {
                    "type": "object",
                    "properties": {
                        "currency": {"type": "string"},
                        "amount": {"type": "number"},
                    },
                    "required": ["currency", "amount"],
                },
            },
            "securitySchemes": {
                "api_key": {"type": "apiKey", "in": "header", "name": "X-Auth-Token"}
            },
        },
    }

    # Generate paths for each evaluator
    for evaluator_id, evaluator in evaluators.items():
        path_key = f"/{evaluator_id.replace('.', '/')}/evaluate"

        # Create evaluator-specific data schema
        data_schema = {"type": "object", "properties": {}}

        # Add all possible fields to properties
        all_fields = [
            "input",
            "output",
            "contexts",
            "expected_output",
            "expected_contexts",
            "conversation",
        ]
        required_fields = []

        for field in all_fields:
            if field in evaluator.get("requiredFields", []):
                required_fields.append(field)

            if field in evaluator.get("requiredFields", []) or field in evaluator.get(
                "optionalFields", []
            ):
                if field == "input":
                    data_schema["properties"]["input"] = {
                        "type": "string",
                        "description": "The input text to evaluate",
                    }
                elif field == "output":
                    data_schema["properties"]["output"] = {
                        "type": "string",
                        "description": "The output text to evaluate",
                    }
                elif field == "contexts":
                    data_schema["properties"]["contexts"] = {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Context information for evaluation",
                    }
                elif field == "expected_output":
                    data_schema["properties"]["expected_output"] = {
                        "type": "string",
                        "description": "Expected output for comparison",
                    }
                elif field == "expected_contexts":
                    data_schema["properties"]["expected_contexts"] = {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Expected context information",
                    }
                elif field == "conversation":
                    data_schema["properties"]["conversation"] = {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "role": {
                                    "type": "string",
                                    "enum": ["user", "assistant", "system"],
                                },
                                "content": {"type": "string"},
                            },
                            "required": ["role", "content"],
                        },
                        "description": "Conversation history",
                    }

        # Add required fields if any
        if required_fields:
            data_schema["required"] = required_fields

        # Create evaluator-specific request schema
        request_schema_name = (
            f"{evaluator_id.replace('.', '_').replace('/', '_')}Request"
        )
        request_schema = {
            "type": "object",
            "properties": {"data": data_schema},
            "required": ["data"],
        }

        # Add settings property to request schema if evaluator has settings
        if evaluator.get("settings"):
            print(f"Adding settings to {evaluator_id}")
            request_schema["properties"]["settings"] = {
                "type": "object",
                "description": "Evaluator settings",
            }
        else:
            print(f"No settings found for {evaluator_id}")

        schema["components"]["schemas"][request_schema_name] = request_schema

        # Create settings schema for this evaluator
        settings_schema = {"type": "object", "properties": {}}

        # Only process settings if the evaluator has settings
        if evaluator.get("settings"):
            for setting_key, setting in evaluator["settings"].items():
                property_def = {
                    "description": setting.get("description", f"{setting_key} setting")
                }

                default_value = setting.get("default")
                if isinstance(default_value, bool):
                    property_def["type"] = "boolean"
                    property_def["default"] = default_value
                elif isinstance(default_value, str):
                    property_def["type"] = "string"
                    property_def["default"] = default_value
                elif isinstance(default_value, (int, float)):
                    property_def["type"] = "number"
                    property_def["default"] = default_value
                elif isinstance(default_value, list):
                    property_def["type"] = "array"
                    # Infer item type for arrays
                    if default_value:
                        first_item = default_value[0]
                        if isinstance(first_item, str):
                            property_def["items"] = {"type": "string"}
                        elif isinstance(first_item, bool):
                            property_def["items"] = {"type": "boolean"}
                        elif isinstance(first_item, (int, float)):
                            property_def["items"] = {"type": "number"}
                        elif isinstance(first_item, dict):
                            property_def["items"] = {"type": "object"}
                        else:
                            property_def["items"] = {"type": "string"}
                    else:
                        property_def["items"] = {"type": "string"}
                    property_def["default"] = default_value
                elif isinstance(default_value, dict):
                    property_def["type"] = "object"
                    property_def["default"] = default_value

                settings_schema["properties"][setting_key] = property_def

        # Add settings schema to components only if there are settings
        if settings_schema["properties"]:
            settings_schema_name = (
                f"{evaluator_id.replace('.', '_').replace('/', '_')}Settings"
            )
            schema["components"]["schemas"][settings_schema_name] = settings_schema

            # Create the path with settings
            schema["paths"][path_key] = {
                "post": {
                    "summary": evaluator["name"],
                    "description": evaluator["description"],
                    "operationId": f"{evaluator_id.replace('.', '_').replace('/', '_')}_evaluate",
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "allOf": [
                                        {
                                            "$ref": f"#/components/schemas/{request_schema_name}"
                                        },
                                        {
                                            "type": "object",
                                            "properties": {
                                                "settings": {
                                                    "$ref": f"#/components/schemas/{settings_schema_name}"
                                                }
                                            },
                                        },
                                    ]
                                }
                            }
                        },
                        "required": True,
                    },
                    "responses": {
                        "200": {
                            "description": "Successful evaluation",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": {
                                            "$ref": "#/components/schemas/EvaluationResult"
                                        },
                                    }
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {"detail": {"type": "string"}},
                                    }
                                }
                            },
                        },
                        "500": {
                            "description": "Internal server error",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {"detail": {"type": "string"}},
                                    }
                                }
                            },
                        },
                    },
                    "x-codeSamples": [
                        {
                            "lang": "python",
                            "label": "Offline Evaluation",
                            "source": f'import langwatch\n\ndf = langwatch.dataset.get_dataset("dataset-id").to_pandas()\n\nevaluation = langwatch.evaluation.init("my-incredible-evaluation")\n\nfor index, row in evaluation.loop(df.iterrows()):\n    # your execution code here       \n    evaluation.run(\n        "{evaluator_id}",\n        index=index,\n        data={{\n{chr(10).join(f"            \"{field}\": row[\"{field}\"]," if field in ["input", "contexts", "expected_output"] else f"            \"{field}\": {field}," for field in evaluator.get("requiredFields", []) + evaluator.get("optionalFields", []))}\n        }},\n        settings={{}}\n    )\n',
                        },
                        {
                            "lang": "python",
                            "label": "Realtime Evaluation",
                            "source": f'import langwatch\n\n@langwatch.span()\ndef llm_step():\n    ... # your existing code\n    result = langwatch.get_current_span().evaluate(\n        "{evaluator_id}",\n        data={{\n{chr(10).join([f"            \"{field}\": \"\"," for field in evaluator.get("requiredFields", []) + evaluator.get("optionalFields", [])])}\n        }},\n        settings={{}},\n    )\n    print(result)',
                        },
                        {
                            "lang": "typescript",
                            "label": "TypeScript",
                            "source": f'import {{ type LangWatchTrace }} from "langwatch";\n\nasync function llmStep({{ message, trace }}: {{ message: string, trace: LangWatchTrace }}): Promise<string> {{\n    const span = trace.startLLMSpan({{ name: "llmStep" }});\n    \n    // ... your existing code\n\n    // call the evaluator either on a span or on a trace\n    const result = await span.evaluate({{\n        evaluator: "{evaluator_id}",\n        name: "",\n{chr(10).join(f"        {field}: \"\", // required" for field in evaluator.get("requiredFields", []))}\n{chr(10).join(f"        {field}: \"\", # optional" for field in evaluator.get("optionalFields", []))}\n        settings: {{}},\n    }})\n\n    console.log(result);',
                        },
                    ],
                }
            }
        else:
            # Create the path without settings for evaluators with no settings
            schema["paths"][path_key] = {
                "post": {
                    "summary": evaluator["name"],
                    "description": evaluator["description"],
                    "operationId": f"{evaluator_id.replace('.', '_').replace('/', '_')}_evaluate",
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": f"#/components/schemas/{request_schema_name}"
                                }
                            }
                        },
                        "required": True,
                    },
                    "responses": {
                        "200": {
                            "description": "Successful evaluation",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": {
                                            "$ref": "#/components/schemas/EvaluationResult"
                                        },
                                    }
                                }
                            },
                        },
                        "400": {
                            "description": "Bad request",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {"detail": {"type": "string"}},
                                    }
                                }
                            },
                        },
                        "500": {
                            "description": "Internal server error",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {"detail": {"type": "string"}},
                                    }
                                }
                            },
                        },
                    },
                    "x-codeSamples": [
                        {
                            "lang": "python",
                            "label": "Offline Evaluation",
                            "source": f'import langwatch\n\ndf = langwatch.dataset.get_dataset("dataset-id").to_pandas()\n\nevaluation = langwatch.evaluation.init("my-incredible-evaluation")\n\nfor index, row in evaluation.loop(df.iterrows()):\n    # your execution code here       \n    evaluation.run(\n        "{evaluator_id}",\n        index=index,\n        data={{\n{chr(10).join(f"            \"{field}\": row[\"{field}\"]," if field in ["input", "contexts", "expected_output"] else f"            \"{field}\": {field}," for field in evaluator.get("requiredFields", []) + evaluator.get("optionalFields", []))}\n        }},\n        settings={{}}\n    )\n',
                        },
                        {
                            "lang": "python",
                            "label": "Realtime Evaluation",
                            "source": f'import langwatch\n\n@langwatch.span()\ndef llm_step():\n    ... # your existing code\n    result = langwatch.get_current_span().evaluate(\n        "{evaluator_id}",\n        data={{\n{chr(10).join([f"            \"{field}\": \"\"," for field in evaluator.get("requiredFields", []) + evaluator.get("optionalFields", [])])}\n        }},\n        settings={{}},\n    )\n    print(result)',
                        },
                        {
                            "lang": "typescript",
                            "label": "TypeScript",
                            "source": f'import {{ type LangWatchTrace }} from "langwatch";\n\nasync function llmStep({{ message, trace }}: {{ message: string, trace: LangWatchTrace }}): Promise<string> {{\n    const span = trace.startLLMSpan({{ name: "llmStep" }});\n    \n    // ... your existing code\n\n    // call the evaluator either on a span or on a trace\n    const result = await span.evaluate({{\n        evaluator: "{evaluator_id}",\n        name: "",\n{chr(10).join(f"        {field}: \"\", // required" for field in evaluator.get("requiredFields", []))}\n{chr(10).join(f"        {field}: \"\", # optional" for field in evaluator.get("optionalFields", []))}\n        settings: {{}},\n    }})\n\n    console.log(result);',
                        },
                    ],
                }
            }

    return schema


def main():
    """Main function to generate OpenAPI schema."""
    try:
        # Find the evaluators.generated.ts file
        script_dir = Path(__file__).parent
        project_root = script_dir.parent
        evaluators_file = project_root / "ts-integration" / "evaluators.generated.ts"

        if not evaluators_file.exists():
            print(f"Error: Could not find evaluators file at {evaluators_file}")
            sys.exit(1)

        print(f"Reading evaluators from: {evaluators_file}")
        evaluators = parse_typescript_evaluators(str(evaluators_file))

        print(f"Found {len(evaluators)} evaluators")
        schema = generate_openapi_schema(evaluators)

        # Write the schema to a file
        output_path = script_dir / "openapi.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(schema, f, indent=2, ensure_ascii=False)

        print(f"OpenAPI schema generated successfully at: {output_path}")
        print(f"Generated {len(evaluators)} evaluator endpoints")

    except Exception as error:
        print(f"Error generating OpenAPI schema: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
