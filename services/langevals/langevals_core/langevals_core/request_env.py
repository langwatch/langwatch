"""The env of the evaluation that is running right now, without os.environ.

Evaluators receive per-request credentials in their `env`, and the model
libraries underneath (litellm, and dspy/ragas/langchain on top of it) resolve
credentials implicitly. The old bridge between the two was writing the request
env into `os.environ`, which is process-global: two concurrent evaluations
with different credentials could read each other's, so the server had to
serialize them. This context is the replacement bridge. The evaluation
machinery binds the request env here, and the litellm patch layer resolves
credentials from it into explicit per-call arguments, so nothing about a
request ever touches the process environment and evaluations with different
credentials can run at the same time.

A ContextVar rather than a threading.local: ragas evaluators run their work on
asyncio tasks, and tasks inherit the context they were created under, so the
binding survives the sync-to-async hop inside one evaluation while staying
invisible to every other thread.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator, Optional

_current_env: ContextVar[Optional[dict[str, str]]] = ContextVar(
    "langevals_request_env", default=None
)


def bind_request_env(env: Optional[dict[str, str]]) -> None:
    """Bind without scoping, for library callers.

    Constructing an evaluator binds its env to the current context, so
    `MyEvaluator(env={...}).evaluate(entry)` keeps working for anyone using
    langevals as a library, the way the old os.environ write did, minus the
    process-global part. Server request handling does not rely on this: every
    batch entry is scoped explicitly by `request_env` around its evaluation.
    """
    _current_env.set(env)


@contextmanager
def request_env(env: Optional[dict[str, str]]) -> Iterator[None]:
    token = _current_env.set(env)
    try:
        yield
    finally:
        _current_env.reset(token)


def current_request_env() -> dict[str, str]:
    return _current_env.get() or {}
