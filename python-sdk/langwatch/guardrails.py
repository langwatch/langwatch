from typing import List, Optional

import langwatch.evaluations
from langwatch.types import Conversation, RAGChunk


def evaluate(
    slug: str,
    input: Optional[str] = None,
    output: Optional[str] = None,
    contexts: List[RAGChunk] = [],
    conversation: Conversation = [],
    settings: Optional[dict] = None,
):
    return langwatch.evaluations.evaluate(
        slug=slug,
        input=input,
        output=output,
        contexts=contexts,
        conversation=conversation,
        settings=settings,
        as_guardrail=True,
    )


async def async_evaluate(
    slug: str,
    input: Optional[str] = None,
    output: Optional[str] = None,
    contexts: List[RAGChunk] = [],
    conversation: Conversation = [],
    settings: Optional[dict] = None,
):
    return await langwatch.evaluations.async_evaluate(
        slug=slug,
        input=input,
        output=output,
        contexts=contexts,
        conversation=conversation,
        settings=settings,
        as_guardrail=True,
    )
