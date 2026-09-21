"""Azure OpenAI, autotracked.

    uv run --with langwatch --with openai python azure_openai.py image

Image only: the deployment below is a Chat Completions model, and the
picture goes in the same `image_url` data-URL part the OpenAI cell uses. The
deployment name is an Azure resource setting, not a model id, so it is read
from AZURE_OPENAI_DEPLOYMENT with a fallback that matches this project's
Azure resource.
"""

import os

from _common import attachment, data_url, question, report, require

import langwatch
from openai import AzureOpenAI

DEPLOYMENT = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-5-mini")
API_VERSION = "2024-10-21"


@langwatch.trace(name="azure openai")
def ask() -> str:
    client = AzureOpenAI(
        api_key=os.environ["AZURE_OPENAI_API_KEY"],
        api_version=API_VERSION,
        azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    )
    langwatch.get_current_trace().autotrack_openai_calls(client)
    langwatch.get_current_trace().update(
        metadata={"labels": ["multimodal-dogfood", "azure-openai", "image"]},
    )

    path, media_type = attachment("image")
    completion = client.chat.completions.create(
        model=DEPLOYMENT,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": question("image")},
                    {
                        "type": "image_url",
                        "image_url": {"url": data_url(path, media_type)},
                    },
                ],
            }
        ],
    )
    return completion.choices[0].message.content or ""


if __name__ == "__main__":
    require("AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "LANGWATCH_API_KEY")
    langwatch.setup()
    report("azure-openai/image", ask())
