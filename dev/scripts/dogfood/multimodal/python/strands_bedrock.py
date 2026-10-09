"""Strands Agent against a real AWS Bedrock model, not LiteLLM or OpenAI.

    uv run --with langwatch --with strands-agents python strands_bedrock.py image
    uv run --with langwatch --with strands-agents python strands_bedrock.py pdf

Strands turns on its own OpenTelemetry instrumentation as soon as a global
tracer provider exists, so `langwatch.setup()` is enough on its own; no
separate instrumentor is needed. The attachment goes in a native Bedrock
Converse content block, an `image` block for a picture or a `document`
block for a PDF, both carrying raw bytes rather than base64 text. The model
is Claude Haiku 4.5 through the EU cross-region inference profile, which
accepts both shapes.
"""

from _common import attachment, modality, question, report, require

import langwatch
from strands import Agent
from strands.models.bedrock import BedrockModel

MODEL_ID = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"
REGION = "eu-central-1"


@langwatch.trace(name="strands bedrock")
def ask(prompt: str, kind: str) -> str:
    langwatch.get_current_trace().update(
        metadata={"labels": ["multimodal-dogfood", "strands-bedrock", kind]},
    )

    model = BedrockModel(model_id=MODEL_ID, region_name=REGION)
    agent = Agent(model=model, system_prompt="Answer directly and concisely.")

    path, media_type = attachment(kind)
    if kind == "image":
        media_block = {
            "image": {"format": "png", "source": {"bytes": path.read_bytes()}}
        }
    else:
        media_block = {
            "document": {
                "format": "pdf",
                "name": "langwatch-invoice",
                "source": {"bytes": path.read_bytes()},
            }
        }

    result = agent([{"text": prompt}, media_block])
    return str(result)


if __name__ == "__main__":
    require("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "LANGWATCH_API_KEY")
    langwatch.setup()
    which = modality()
    report(f"strands-bedrock/{which}", ask(question(which), which))
