from typing import Any, Dict, List, Optional

from langwatch import evaluation
from langwatch.evaluation import _merge_keyword_data
from langwatch.types import Conversation, RAGChunk


def evaluate(
    slug: str,
    input: Optional[str] = None,
    output: Optional[str] = None,
    expected_output: Optional[str] = None,
    contexts: List[RAGChunk] = [],
    conversation: Conversation = [],
    settings: Optional[Dict[str, Any]] = None,
):
    contexts = contexts or []
    conversation = conversation or []

    return evaluation.evaluate(
        slug=slug,
        data=_merge_keyword_data(
            input=input,
            output=output,
            expected_output=expected_output,
            contexts=contexts,
            conversation=conversation,
        ),
        settings=settings,
        as_guardrail=True,
    )


async def async_evaluate(
    slug: str,
    input: Optional[str] = None,
    output: Optional[str] = None,
    expected_output: Optional[str] = None,
    contexts: List[RAGChunk] = [],
    conversation: Conversation = [],
    settings: Optional[Dict[str, Any]] = None,
):
    contexts = contexts or []
    conversation = conversation or []

    return await evaluation.async_evaluate(
        slug=slug,
        data=_merge_keyword_data(
            input=input,
            output=output,
            expected_output=expected_output,
            contexts=contexts,
            conversation=conversation,
        ),
        settings=settings,
        as_guardrail=True,
    )
