"""Request features the router reads: token count and the arithmetic flag."""
from __future__ import annotations

import re
from typing import Callable, Optional

# The arithmetic feature rule the routes were measured with. It also fires on any digit, so it flags many everyday
# checks; prefer a flag from the caller (the search rewrite call) where one exists.
ARITH_RE = re.compile(
    r"\b(how many|count(s|ed|ing)?|total(s|led)?|sum|average|mean|percent(age)?|more than \d|less than \d|at least \d|at most \d|"
    r"number of|amount|price|cost|refund|fee|charge|discount|balance|date|deadline|days?|weeks?|months?|hours?|minutes?|before|"
    r"after|within|late|early|calculat\w*|correct (figure|total|amount)|exceed\w*)\b|[%€$£]|\d",
    re.IGNORECASE,
)

# Bytes per token of judged text (instant-eval-judge INSTANT_EVAL_CLASSIFIER_LIMITS.bytesPerInputToken). Only used when
# the caller has no token count; the routes were measured on cl100k-style counts of the full input.
BYTES_PER_TOKEN = 2.7


def estimate_tokens(text: str) -> int:
    return int(len(text.encode("utf-8")) / BYTES_PER_TOKEN) + 1


def arithmetic_regex(question: str) -> bool:
    return bool(ARITH_RE.search(question or ""))


# A hook for the flag: the search rewrite call can return it; anything with this shape can be passed to route().
ArithmeticHook = Callable[[str], Optional[bool]]


def arithmetic_flag(job: str, question: str, from_request: Optional[bool], source: str,
                    hook: Optional[ArithmeticHook] = None) -> tuple[bool, str]:
    """(flag, where it came from). source is one of request, regex, request_then_regex."""
    if source in ("request", "request_then_regex"):
        if from_request is not None:
            return bool(from_request), "request"
        if hook is not None:
            v = hook(question)
            if v is not None:
                return bool(v), "hook"
        if source == "request":
            return False, "none"
    return arithmetic_regex(question), "regex"
