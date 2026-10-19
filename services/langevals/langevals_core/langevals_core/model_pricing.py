"""LangWatch's own model pricing, registered into LiteLLM's cost map.

The app keeps a static model catalog with per-token prices
(modules/model-provider/contract/src/catalog/model-catalog.json plus the
hand-curated model-catalog.overlay.json). LangEvals registers those prices with
LiteLLM once at startup, so evaluation costs match the prices the app shows and
never depend on a price list fetched at runtime.

The catalog is read from LANGWATCH_MODEL_PRICING_DIR (the image copies both
files there) or, in a checkout, straight from the app's source tree.
"""

import json
import logging
import os
import warnings
from pathlib import Path
from typing import Any, Dict, Optional

import litellm
from litellm._logging import verbose_logger

PRICING_DIR_ENV = "LANGWATCH_MODEL_PRICING_DIR"
CATALOG_FILES = ("model-catalog.json", "model-catalog.overlay.json")

_CHECKOUT_DIR = (
    Path(__file__).resolve().parents[4]
    / "modules"
    / "model-provider"
    / "contract"
    / "src"
    / "catalog"
)

# Our catalog field -> LiteLLM cost map field.
_PRICE_FIELDS = {
    "inputCostPerToken": "input_cost_per_token",
    "outputCostPerToken": "output_cost_per_token",
    "inputCacheReadPerToken": "cache_read_input_token_cost",
    "inputCacheWritePerToken": "cache_creation_input_token_cost",
}

_MODES = {"chat", "embedding"}


def pricing_dir() -> Optional[Path]:
    configured = os.environ.get(PRICING_DIR_ENV)
    if configured:
        return Path(configured)
    if (_CHECKOUT_DIR / CATALOG_FILES[0]).is_file():
        return _CHECKOUT_DIR
    return None


def load_catalog(directory: Path) -> Dict[str, Dict[str, Any]]:
    """The merged catalog, keyed by model id. The overlay wins on collision,
    the same rule the app's loadModelCatalog.ts applies."""
    models: Dict[str, Dict[str, Any]] = {}
    for name in CATALOG_FILES:
        path = directory / name
        if path.is_file():
            models.update(json.loads(path.read_text()).get("models", {}))
    return models


def to_litellm_cost_map(
    models: Dict[str, Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    cost_map: Dict[str, Dict[str, Any]] = {}
    for model_id, model in models.items():
        mode = model.get("mode", "chat")
        provider = model.get("provider") or model_id.split("/", 1)[0]
        pricing = model.get("pricing") or {}
        if mode not in _MODES or provider.startswith("~"):
            continue
        entry: Dict[str, Any] = {"litellm_provider": provider, "mode": mode}
        for ours, theirs in _PRICE_FIELDS.items():
            if isinstance(pricing.get(ours), (int, float)):
                entry[theirs] = pricing[ours]
        if "input_cost_per_token" not in entry:
            continue
        cost_map[model_id] = entry
    return cost_map


def register_langwatch_model_pricing() -> int:
    """Register the catalog's prices with LiteLLM. Returns how many models
    were registered; 0 when no catalog is available."""
    directory = pricing_dir()
    if directory is None:
        warnings.warn(
            "LangWatch model pricing not found; costs fall back to LiteLLM's bundled price list."
        )
        return 0
    cost_map = to_litellm_cost_map(load_catalog(directory))
    if cost_map:
        # register_model probes each provider name and warns once per model
        # it does not already know; for a whole catalog that is hundreds of
        # startup lines saying the same thing.
        was_debug_info_suppressed = litellm.suppress_debug_info
        log_level = verbose_logger.level
        litellm.suppress_debug_info = True
        verbose_logger.setLevel(logging.ERROR)
        try:
            litellm.register_model(cost_map)
        finally:
            litellm.suppress_debug_info = was_debug_info_suppressed
            verbose_logger.setLevel(log_level)
    return len(cost_map)
