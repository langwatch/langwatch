"""Minimal `dspy` stand-in for the nlpgo code-block subprocess.

The full `dspy` package weighs hundreds of MB once its transitive deps
(litellm, ujson, jsonschema, optuna, ...) are pulled in. Bundling that
into the lambda image is wasted weight: a redacted survey of every
code-block in production showed customers use only seven names from
the dspy surface, and 98% of usage is just `dspy.Module` as a no-op
base class for the customer's `forward()` method.

This module exposes exactly that surface and nothing more. It is
injected into `sys.modules['dspy']` by the runner before the user's
code is exec'd, so existing customer code that does `import dspy` and
subclasses `dspy.Module` keeps working byte-for-byte without ever
importing the real package.

Anything beyond the surface here (training, retrievers other than the
no-op `retrieve`, optimizers, adapters, signatures with schema
inference, ...) is **not supported** in nlpgo. Customers that need
those keep running on the legacy Python path until the feature flag
flips them over — at which point the surface here gets extended or
the customer's workflow gets rewritten to the plain-Python shape.

Survey snapshot (input for this stub): /tmp/nlpgo-codeblock-survey.md
(gitignored). Numbers: 388 Module, 6 Prediction, 4 InputField,
2 Signature, 2 OutputField, 2 Predict, 1 retrieve.
"""

from __future__ import annotations

from typing import Any


class Module:
    """No-op base class.

    Real `dspy.Module` carries deep-copy / parameter-tracking machinery
    that's only meaningful when the surrounding optimizer is wired up.
    Customer code-blocks neither rely on nor invoke that machinery; the
    survey shows every usage just inherits to get a `forward()` slot
    plus the implicit `__call__` → `forward` shortcut. We provide both.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        # Accept whatever the customer passes — real dspy.Module's
        # __init__ accepts arbitrary args too, so this stays parity.
        pass

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        forward = getattr(self, "forward", None)
        if forward is None:
            raise NotImplementedError(
                f"{type(self).__name__} subclasses dspy.Module but defines no forward()"
            )
        return forward(*args, **kwargs)


class Signature:
    """Marker base class — 2 customer uses, no behavioral expectation."""

    pass


class Prediction:
    """Lightweight `dataclasses.SimpleNamespace`-like return value.

    Customer code constructs `dspy.Prediction(answer="42", score=0.9)`
    and expects both attribute access (`p.answer`) and dict-like access
    (`p["answer"]`). Real dspy adds copy/iteration semantics we
    haven't observed in customer use, so we keep the stub strictly to
    what was surveyed.
    """

    def __init__(self, **kwargs: Any) -> None:
        self.__dict__.update(kwargs)

    def __getitem__(self, key: str) -> Any:
        return self.__dict__[key]

    def __iter__(self):
        return iter(self.__dict__)

    def __repr__(self) -> str:
        kvs = ", ".join(f"{k}={v!r}" for k, v in self.__dict__.items())
        return f"Prediction({kvs})"


def InputField(*args: Any, **kwargs: Any) -> None:
    """Schema marker. Customer-side has no observable behavior."""
    return None


def OutputField(*args: Any, **kwargs: Any) -> None:
    """Schema marker. Customer-side has no observable behavior."""
    return None


class Predict:
    """Stub that fails loudly when invoked.

    Real `dspy.Predict` performs an LLM call. The two customers using
    it should route through the workflow's signature node instead;
    silently no-op'ing would mask broken workflows. Constructor is
    cheap (matches survey: callers pass a Signature class as positional
    arg) but `__call__` raises so the failure surfaces during execution
    rather than producing empty Predictions.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        raise RuntimeError(
            "dspy.Predict is not supported in the nlpgo code-block subprocess. "
            "Use the workflow's signature node for LLM calls; if this code "
            "must stay, it should run on the legacy langwatch_nlp path."
        )


# `retrieve` was observed exactly once (a customer importing
# `dspy.retrieve.neo4j_rm` for a Neo4j RAG step). That codepath needs
# the real third-party retriever class anyway — the customer must
# stay on the legacy path until they migrate to a workflow-level
# retriever node. Intentionally absent from the stub so the
# AttributeError surfaces at import time, not at call time.

__all__ = [
    "Module",
    "Signature",
    "Prediction",
    "InputField",
    "OutputField",
    "Predict",
]
