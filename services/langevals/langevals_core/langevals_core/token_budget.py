"""Fitting a judge's content to its token budget.

Content over the budget is cut keeping its opening and its ending, with a
marker naming how much was left out of the middle: the same rule as
cutToEstimatedTokensKeepingEnds in @langwatch/trace-contract.
Spec: specs/evaluators/langevals-judge-long-content.feature
"""

from dataclasses import dataclass
from typing import Optional

import litellm

from langevals_core.base_evaluator import (
    MAX_TOKENS_HARD_LIMIT,
    EvaluationResultSkipped,
)
from langevals_core.image_support import detect_image

# Left for the judge's answer inside the model's input window.
ANSWER_RESERVE_TOKENS = 8_192

# Tokenizers disagree across providers and a joined message is not the sum of
# its parts; this share of the room is kept free for both.
TOKEN_COUNT_SLACK = 0.03

# For a field's "# Input" heading, and for a context's number in the list.
FIELD_OVERHEAD_TOKENS = 8
CONTEXT_OVERHEAD_TOKENS = 4

# Below this, a kept ending is too short to read and the cut keeps the head only.
MIN_KEPT_END_TOKENS = 32

# Below this much room for the content there is nothing worth judging.
MIN_CONTENT_TOKENS = 256


def elision_marker(omitted_tokens: int) -> str:
    return f"\n\n[... {omitted_tokens} tokens omitted from the middle to fit the length limit ...]\n\n"


def count_tokens(model: str, text: str) -> int:
    return len(litellm.encode(model=model, text=text))  # type: ignore


def judge_token_budget(model: str, max_tokens: int) -> int:
    """The evaluator's max tokens setting, capped by the hard limit and by the
    model's own input window less room for the answer."""
    budget = min(max_tokens, MAX_TOKENS_HARD_LIMIT)
    try:
        window = litellm.get_model_info(model).get("max_input_tokens")
    except Exception:
        window = None
    if isinstance(window, int) and window > ANSWER_RESERVE_TOKENS:
        budget = min(budget, window - ANSWER_RESERVE_TOKENS)
    return budget


def cut_keeping_ends(model: str, text: str, max_tokens: int) -> tuple[str, int]:
    """`text` cut to `max_tokens` keeping both ends, and the tokens omitted."""
    total = count_tokens(model, text)
    if total <= max_tokens:
        return text, 0
    chars_per_token = len(text) / max(1, total)
    room = max_tokens - count_tokens(model, elision_marker(total))
    if room < MIN_KEPT_END_TOKENS * 2:
        head = text[: max(0, int(max_tokens * chars_per_token))]
        while head and count_tokens(model, head) > max_tokens:
            head = head[: int(len(head) * 0.9)]
        return head, total - count_tokens(model, head)

    keep = room
    head, tail, kept = "", "", 0
    for _ in range(8):
        half = int(keep / 2 * chars_per_token)
        head, tail = text[:half], text[len(text) - half :]
        kept = count_tokens(model, head) + count_tokens(model, tail)
        if kept <= room:
            break
        keep = int(keep * room / kept * 0.97)
    omitted = max(1, total - kept)
    return f"{head}{elision_marker(omitted)}{tail}", omitted


@dataclass
class FittedContent:
    input: Optional[str] = None
    output: Optional[str] = None
    expected_output: Optional[str] = None
    contexts: Optional[list[str]] = None
    omitted_tokens: int = 0
    budget: int = 0

    def note(self) -> Optional[str]:
        """What the judge did not see, for the result details."""
        if not self.omitted_tokens:
            return None
        return (
            f"{self.omitted_tokens} tokens were omitted from the middle of the content "
            f"to fit the maximum of {self.budget} tokens."
        )

    def with_note(self, details: Optional[str]) -> Optional[str]:
        note = self.note()
        if note is None:
            return details
        return f"{details}\n\n{note}" if details else note


def fit_contexts(model: str, contexts: list[str], budget: int) -> tuple[list[str], int]:
    """The contexts cut to `budget` as one list: whole contexts kept from the
    start and from the end, a marker entry for the ones left out between, and
    a single context larger than its half cut keeping its own ends."""
    sizes = [count_tokens(model, context) + CONTEXT_OVERHEAD_TOKENS for context in contexts]
    total = sum(sizes)
    if total <= budget:
        return contexts, 0
    half = budget // 2
    head: list[str] = []
    used = 0
    for context, size in zip(contexts, sizes):
        if used + size > half:
            break
        head.append(context)
        used += size
    tail: list[str] = []
    used = 0
    for context, size in zip(reversed(contexts[len(head) :]), reversed(sizes[len(head) :])):
        if used + size > half:
            break
        tail.insert(0, context)
        used += size
    omitted = 0
    if not head and not tail:
        first, omitted = cut_keeping_ends(model, contexts[0], half)
        head = [first]
    if not tail and len(contexts) > len(head):
        last, left_out = cut_keeping_ends(model, contexts[-1], half)
        tail, omitted = [last], omitted + left_out
    middle = contexts[len(head) : len(contexts) - len(tail)]
    omitted += sum(sizes[len(head) : len(contexts) - len(tail)])
    if not middle:
        return head + tail, omitted
    marker = f"[... {len(middle)} contexts, {omitted} tokens, omitted from the middle to fit the length limit ...]"
    return head + [marker] + tail, omitted


def fit_judge_content(
    *,
    model: str,
    max_tokens: int,
    reserved_texts: list[str],
    input: Optional[str] = None,
    output: Optional[str] = None,
    expected_output: Optional[str] = None,
    contexts: Optional[list[str]] = None,
) -> FittedContent | EvaluationResultSkipped:
    """The fields cut so that they and `reserved_texts` (the evaluator's own
    prompt text) fit the budget. Fields that fit their share stay whole; the
    rest split what is left. Image references are never cut. Skipped, with
    the numbers, only when the prompt leaves no room for any content."""
    budget = judge_token_budget(model, max_tokens)
    reserved = sum(count_tokens(model, text) for text in reserved_texts)

    named = [("input", input), ("output", output), ("expected_output", expected_output)]
    fields: list[tuple[str, object, int]] = [
        (key, text, count_tokens(model, text) + FIELD_OVERHEAD_TOKENS)
        for key, text in named
        if isinstance(text, str) and text and not detect_image(text)
    ]
    kept_contexts = [c for c in contexts or [] if not detect_image(c)]
    if kept_contexts:
        context_tokens = sum(count_tokens(model, c) + CONTEXT_OVERHEAD_TOKENS for c in kept_contexts)
        fields.append(("contexts", kept_contexts, context_tokens + FIELD_OVERHEAD_TOKENS))
    if reserved + sum(tokens for _, _, tokens in fields) <= budget:
        return FittedContent(
            input=input,
            output=output,
            expected_output=expected_output,
            contexts=contexts,
            budget=budget,
        )

    room = int((budget - reserved) * (1 - TOKEN_COUNT_SLACK))
    if room < MIN_CONTENT_TOKENS:
        return EvaluationResultSkipped(
            details=(
                f"The evaluator prompt takes {reserved} tokens, which leaves no room "
                f"for the content within the maximum of {budget} tokens."
            )
        )

    fitted: dict = {}
    omitted = 0
    remaining = room
    ordered = sorted(fields, key=lambda field: field[2])
    for position, (key, value, tokens) in enumerate(ordered):
        share = remaining // (len(ordered) - position)
        if tokens <= share:
            fitted[key] = value
            remaining -= tokens
            continue
        if key == "contexts":
            fitted[key], left_out = fit_contexts(model, value, share - FIELD_OVERHEAD_TOKENS)  # type: ignore
        else:
            fitted[key], left_out = cut_keeping_ends(model, value, share - FIELD_OVERHEAD_TOKENS)  # type: ignore
        omitted += left_out
        remaining -= share

    images = [c for c in contexts or [] if detect_image(c)]
    return FittedContent(
        input=fitted.get("input", input),
        output=fitted.get("output", output),
        expected_output=fitted.get("expected_output", expected_output),
        contexts=(fitted.get("contexts", []) + images) if contexts is not None else None,
        omitted_tokens=omitted,
        budget=budget,
    )
