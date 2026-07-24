#!/usr/bin/env python3
"""
Python script to generate MDX list from OpenAPI JSON
"""

import json
import sys
from pathlib import Path
from typing import Dict, Any, List


def categorize_evaluators(
    evaluators: Dict[str, Any],
) -> Dict[str, Dict[str, Any]]:
    """Categorize evaluators based on their paths and descriptions."""

    categories = {
        "Expected Answer Evaluation": {
            "description": "For when you have the golden answer and want to measure how correct the LLM gets it",
            "evaluators": [],
        },
        "LLM-as-Judge": {
            "description": "For when you don't have a golden answer, but have a set of rules for another LLM to evaluate quality",
            "evaluators": [],
        },
        "RAG Quality": {
            "description": "For measuring the quality of your RAG, check for hallucinations with faithfulness and precision/recall",
            "evaluators": [],
        },
        "Quality Aspects Evaluation": {
            "description": "For when you want to check the language, structure, style and other general quality metrics",
            "evaluators": [],
        },
        "Safety": {
            "description": "Check for PII, prompt injection attempts and toxic content",
            "evaluators": [],
        },
        "Other": {"description": "Miscellaneous evaluators", "evaluators": []},
    }

    for path, path_info in evaluators.items():
        if not path.endswith("/evaluate"):
            continue

        evaluator_id = path.replace("/evaluate", "")
        post_info = path_info.get("post", {})
        summary = post_info.get("summary", evaluator_id)
        description = post_info.get("description", "")

        # Convert evaluator name to proper endpoint format
        # Use the evaluator name and convert to kebab-case
        endpoint_id = summary.lower()
        # Replace spaces and special characters with hyphens
        endpoint_id = endpoint_id.replace(" ", "-")
        endpoint_id = endpoint_id.replace("_", "-")
        endpoint_id = endpoint_id.replace("/", "-")
        # Remove any non-alphanumeric characters except hyphens
        import re

        endpoint_id = re.sub(r"[^a-z0-9\-]", "", endpoint_id)
        # Remove multiple consecutive hyphens
        endpoint_id = re.sub(r"-+", "-", endpoint_id)
        # Remove leading/trailing hyphens
        endpoint_id = endpoint_id.strip("-")

        evaluator_info = {
            "id": evaluator_id,
            "name": summary,
            "description": description,
            "endpoint": f"/api-reference/{endpoint_id}",
        }

        # Categorize based on path and description
        if any(
            keyword in evaluator_id.lower()
            for keyword in [
                "exact_match",
                "llm_answer_match",
                "factual",
                "sql_query",
                "rouge",
                "bleu",
            ]
        ):
            categories["Expected Answer Evaluation"]["evaluators"].append(
                evaluator_info
            )
        elif any(
            keyword in evaluator_id.lower()
            for keyword in ["llm_boolean", "llm_score", "llm_category", "rubrics"]
        ):
            categories["LLM-as-Judge"]["evaluators"].append(evaluator_info)
        elif any(
            keyword in evaluator_id.lower()
            for keyword in [
                "faithfulness",
                "context_precision",
                "context_recall",
                "context_f1",
                "response_relevancy",
                "response_context",
            ]
        ):
            categories["RAG Quality"]["evaluators"].append(evaluator_info)
        elif any(
            keyword in evaluator_id.lower()
            for keyword in ["language_detection", "valid_format", "summarization"]
        ):
            categories["Quality Aspects Evaluation"]["evaluators"].append(
                evaluator_info
            )
        elif any(
            keyword in evaluator_id.lower()
            for keyword in [
                "pii",
                "jailbreak",
                "prompt_injection",
                "content_safety",
                "moderation",
                "llama_guard",
            ]
        ):
            categories["Safety"]["evaluators"].append(evaluator_info)
        else:
            categories["Other"]["evaluators"].append(evaluator_info)

    return categories


def generate_mdx(categories: Dict[str, Any]) -> str:
    """Generate MDX content."""

    mdx_content = []

    for category_name, category_info in categories.items():
        if not category_info["evaluators"]:
            continue

        mdx_content.append(f"## {category_name}")
        mdx_content.append(f"{category_info['description']}")
        mdx_content.append("")
        mdx_content.append("| Evaluator | Description |")
        mdx_content.append("| --------- | ----------- |")

        for evaluator in category_info["evaluators"]:
            # Clean description to remove newlines but keep full text
            desc = evaluator["description"]
            # Remove newlines and normalize whitespace
            desc = " ".join(desc.split())

            mdx_content.append(
                f"| [{evaluator['name']}]({evaluator['endpoint']}) | {desc} |"
            )

        mdx_content.append("")

    return "\n".join(mdx_content)


def main():
    """Main function to generate MDX list."""
    try:
        # Find the openapi.json file
        script_dir = Path(__file__).parent
        openapi_file = script_dir / "openapi.json"

        if not openapi_file.exists():
            print(f"Error: Could not find OpenAPI file at {openapi_file}")
            sys.exit(1)

        print(f"Reading OpenAPI from: {openapi_file}")

        with open(openapi_file, "r", encoding="utf-8") as f:
            openapi_data = json.load(f)

        paths = openapi_data.get("paths", {})
        categories = categorize_evaluators(paths)
        mdx_content = generate_mdx(categories)

        # Write the MDX content to a file
        output_path = script_dir / "evaluators-list.mdx"
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(mdx_content)

        print(f"MDX list generated successfully at: {output_path}")

        # Print summary
        total_evaluators = sum(len(cat["evaluators"]) for cat in categories.values())
        active_categories = len(
            [cat for cat in categories.values() if cat["evaluators"]]
        )
        print(
            f"Generated {total_evaluators} evaluators across {active_categories} categories"
        )

    except Exception as error:
        print(f"Error generating MDX list: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
