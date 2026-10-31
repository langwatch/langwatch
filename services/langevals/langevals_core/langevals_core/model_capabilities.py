"""What LangWatch's model catalog records about how a model takes a request.

Read from the same catalog files as the prices (model_pricing.py), so a model
gains a capability by its catalog entry rather than by a name list kept here.
"""

from functools import lru_cache
from typing import Any, Dict, Optional

from langevals_core.model_pricing import load_catalog, pricing_dir

DEFAULT_OUTPUT_TOKENS_PARAMETER = "max_tokens"


@lru_cache(maxsize=1)
def _catalog() -> Dict[str, Dict[str, Any]]:
    directory = pricing_dir()
    return load_catalog(directory) if directory is not None else {}


def catalog_entry(model: Optional[str]) -> Optional[Dict[str, Any]]:
    """The catalog entry for a litellm model id. litellm reads an unprefixed id
    as OpenAI's, and an Azure deployment serves an OpenAI model, so `<name>`
    and `azure/<name>` are looked up as `openai/<name>`."""
    if not model:
        return None
    models = _catalog()
    if model in models:
        return models[model]
    provider, _, name = model.partition("/")
    if not name:
        return models.get(f"openai/{provider}")
    if provider == "azure":
        return models.get(f"openai/{name}")
    return None


def output_tokens_parameter(model: Optional[str]) -> Optional[str]:
    """The parameter the model takes its output token limit as, or None when
    the catalog does not carry the model."""
    entry = catalog_entry(model)
    if entry is None:
        return None
    return entry.get("outputTokensParameter", DEFAULT_OUTPUT_TOKENS_PARAMETER)
