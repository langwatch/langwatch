from .base_evaluator import EvaluatorEntry
from typing import Optional
import litellm


# @param model: litellm model string
def calculate_total_tokens(model: str, entry: EvaluatorEntry):
    input: Optional[str] = entry.input if hasattr(entry, "input") else None  # type: ignore
    output: Optional[str] = entry.output if hasattr(entry, "output") else None  # type: ignore
    contexts: Optional[list[str]] = entry.contexts if hasattr(entry, "contexts") else None  # type: ignore
    expected_output: Optional[str] = entry.expected_output if hasattr(entry, "expected_output") else None  # type: ignore

    total_tokens = 0
    total_tokens += len(litellm.encode(model=model, text=input or ""))
    total_tokens += len(litellm.encode(model=model, text=output or ""))
    total_tokens += len(litellm.encode(model=model, text=expected_output or ""))
    if contexts is not None:
        for context in contexts:
            tokens = litellm.encode(model=model, text=context)
            total_tokens += len(tokens)

    return total_tokens
