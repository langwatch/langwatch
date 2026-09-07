"""OpenAI official SDK, autotracked.

    uv run --with langwatch --with openai python openai_official.py image
    uv run --with langwatch --with openai python openai_official.py pdf

An image goes in an `image_url` part, as a data URL. A document goes in a
`file` part carrying `file_data`, which is the shape Chat Completions accepts
for PDFs.
"""

from _common import attachment, data_url, modality, question, report, require

import langwatch
from openai import OpenAI

MODEL = "gpt-5-mini"


@langwatch.trace(name="openai official sdk")
def ask(prompt: str, kind: str) -> str:
    # The traced entry point takes the user's text, so the trace's headline
    # input is that text and the attachment only ever appears on the model-call
    # span below. That is the shape a real application produces.
    client = OpenAI()
    langwatch.get_current_trace().autotrack_openai_calls(client)
    langwatch.get_current_trace().update(
        metadata={"labels": ["multimodal-dogfood", "openai-python", kind]},
    )

    path, media_type = attachment(kind)
    if kind == "image":
        media_part = {
            "type": "image_url",
            "image_url": {"url": data_url(path, media_type)},
        }
    else:
        media_part = {
            "type": "file",
            "file": {
                "filename": path.name,
                "file_data": data_url(path, media_type),
            },
        }

    completion = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": [{"type": "text", "text": prompt}, media_part],
            }
        ],
    )
    return completion.choices[0].message.content or ""


if __name__ == "__main__":
    require("OPENAI_API_KEY", "LANGWATCH_API_KEY")
    langwatch.setup()
    which = modality()
    report(f"openai-python/{which}", ask(question(which), which))
