"""The provider usage of the work that is running right now, for the spend ledger.

Every model call langevals makes runs on an organization's stored provider
credentials, and the platform bills those calls against the organization's
budgets (dev/docs/adr/193-platform-calls-on-stored-credentials-report-usage.md).
The litellm patch layer records each answered call here; the code that owns a
unit of work (one evaluator entry, one clustering request) opens a collection
around it and returns what it collected on its response, summed per model.

A ContextVar for the same reason as `request_env`: ragas runs on asyncio tasks
and topic clustering fans out with `contextvars.copy_context().run`, and both
inherit the collection, which is one shared mutable object, from the caller.
"""

from contextlib import contextmanager
from contextvars import ContextVar
import threading
from typing import Any, Iterator, List, Optional

from pydantic import BaseModel

USAGE_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
    "reasoning_tokens",
)


class ModelUsage(BaseModel):
    """What the calls to one model consumed. `input_tokens` excludes the
    cached tokens, which are counted in their own fields, so every bucket is
    priced exactly once."""

    model: str
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0
    reasoning_tokens: int = 0


class UsageCollection:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._by_model: dict[str, ModelUsage] = {}

    def add(self, model: str, quantities: dict[str, int]) -> None:
        with self._lock:
            usage = self._by_model.setdefault(model, ModelUsage(model=model))
            usage.calls += 1
            for field in USAGE_FIELDS:
                setattr(usage, field, getattr(usage, field) + quantities.get(field, 0))

    def models(self) -> List[ModelUsage]:
        with self._lock:
            return [usage.model_copy() for usage in self._by_model.values()]


_current: ContextVar[Optional[UsageCollection]] = ContextVar(
    "langevals_usage_collection", default=None
)


@contextmanager
def collect_usage() -> Iterator[UsageCollection]:
    collection = UsageCollection()
    token = _current.set(collection)
    try:
        yield collection
    finally:
        _current.reset(token)


def ledger_model_id(model: Optional[str]) -> str:
    """The registry id the call is rated under: litellm reads a bare model
    name as openai, so the ledger names it that way too."""
    if not model:
        return ""
    return model if "/" in model else f"openai/{model}"


def _int(value: Any) -> int:
    return value if isinstance(value, int) and value > 0 else 0


def _field(source: Any, name: str) -> Any:
    if source is None:
        return None
    if isinstance(source, dict):
        return source.get(name)
    return getattr(source, name, None)


def quantities_of(response: Any) -> Optional[dict[str, int]]:
    """The billable quantities of one litellm answer, or None when it states
    no usage (a stream, a test double)."""
    usage = _field(response, "usage")
    if usage is None:
        return None
    prompt = _int(_field(usage, "prompt_tokens"))
    cache_read = _int(_field(_field(usage, "prompt_tokens_details"), "cached_tokens")) or _int(
        _field(usage, "cache_read_input_tokens")
    )
    cache_creation = _int(_field(usage, "cache_creation_input_tokens"))
    billable_input = prompt - cache_read - cache_creation
    return {
        # Counts that disagree with each other charge the whole prompt.
        "input_tokens": billable_input if billable_input >= 0 else prompt,
        "output_tokens": _int(_field(usage, "completion_tokens")),
        "cache_read_input_tokens": cache_read if billable_input >= 0 else 0,
        "cache_creation_input_tokens": cache_creation if billable_input >= 0 else 0,
        "reasoning_tokens": _int(
            _field(_field(usage, "completion_tokens_details"), "reasoning_tokens")
        ),
    }


def record_usage(model: Optional[str], response: Any) -> None:
    """Called by the litellm patch for every answered call. A call made
    outside any collection (a library user, a test) is not recorded."""
    collection = _current.get()
    if collection is None:
        return
    quantities = quantities_of(response)
    ledger_model = ledger_model_id(model)
    if quantities is None or not ledger_model:
        return
    collection.add(ledger_model, quantities)
