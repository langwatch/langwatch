"""Anthropic official SDK, instrumented through OpenInference.

    uv run --with langwatch --with anthropic --with openinference-instrumentation-anthropic python anthropic_official.py image
    uv run --with langwatch --with anthropic --with openinference-instrumentation-anthropic python anthropic_official.py pdf

An image goes in an `image` content block with a base64 source. A
document goes in a `document` content block the same way, with media type
application/pdf. `AnthropicInstrumentor` patches the client globally, so a
plain `client.messages.create` call is enough to produce a span.
"""

from _common import attachment, b64, modality, question, report, require

import langwatch
from anthropic import Anthropic
from openinference.instrumentation.anthropic import AnthropicInstrumentor

MODEL = "claude-haiku-4-5-20251001"


@langwatch.trace(name="anthropic official sdk")
def ask(prompt: str, kind: str) -> str:
    # The traced entry point takes the user's text, so the trace's headline
    # input is that text and the attachment only ever appears on the model-call
    # span below. That is the shape a real application produces.
    client = Anthropic()
    langwatch.get_current_trace().update(
        metadata={"labels": ["multimodal-dogfood", "anthropic-python", kind]},
    )

    path, media_type = attachment(kind)
    block_type = "image" if kind == "image" else "document"
    media_block = {
        "type": block_type,
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": b64(path),
        },
    }

    message = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [{"type": "text", "text": prompt}, media_block],
            }
        ],
    )
    return message.content[0].text


if __name__ == "__main__":
    require("ANTHROPIC_API_KEY", "LANGWATCH_API_KEY")
    langwatch.setup(instrumentors=[AnthropicInstrumentor()])
    which = modality()
    report(f"anthropic-python/{which}", ask(question(which), which))
