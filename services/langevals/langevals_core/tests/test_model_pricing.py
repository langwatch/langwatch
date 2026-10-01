"""LangEvals prices LLM calls from LangWatch's own model catalog, and never
downloads LiteLLM's price list. No API keys and no network."""

import json
import os
import subprocess
import sys

import litellm
from litellm.cost_calculator import cost_per_token

from langevals_core.model_pricing import (
    PRICING_DIR_ENV,
    load_catalog,
    pricing_dir,
    register_langwatch_model_pricing,
    to_litellm_cost_map,
)


def write_catalog(directory, name, models):
    (directory / name).write_text(json.dumps({"models": models}))


def model(model_id, input_cost, output_cost, **extra):
    return {
        "id": model_id,
        "provider": model_id.split("/", 1)[0],
        "mode": extra.pop("mode", "chat"),
        "pricing": {
            "inputCostPerToken": input_cost,
            "outputCostPerToken": output_cost,
            **extra,
        },
    }


class TestToLitellmCostMap:
    def test_maps_prices_and_cache_fields(self):
        cost_map = to_litellm_cost_map(
            {
                "acme/acme-model-1": model(
                    "acme/acme-model-1",
                    0.001,
                    0.002,
                    inputCacheReadPerToken=0.0001,
                    inputCacheWritePerToken=0.0003,
                )
            }
        )

        assert cost_map == {
            "acme/acme-model-1": {
                "litellm_provider": "acme",
                "mode": "chat",
                "input_cost_per_token": 0.001,
                "output_cost_per_token": 0.002,
                "cache_read_input_token_cost": 0.0001,
                "cache_creation_input_token_cost": 0.0003,
            }
        }

    def test_skips_aliases_unsupported_modes_and_unpriced_models(self):
        unpriced = model("acme/unpriced", 0.1, 0.1)
        unpriced["pricing"] = {}
        cost_map = to_litellm_cost_map(
            {
                "~acme/alias": model("~acme/alias", 0.1, 0.1),
                "acme/image": model("acme/image", 0.1, 0.1, mode="image"),
                "acme/unpriced": unpriced,
                "acme/embed": model("acme/embed", 0.1, 0, mode="embedding"),
            }
        )

        assert list(cost_map) == ["acme/embed"]


class TestRegisterLangwatchModelPricing:
    def test_overlay_wins_and_litellm_prices_from_it(self, tmp_path, monkeypatch):
        write_catalog(
            tmp_path,
            "llmModels.json",
            {"acme/acme-model-1": model("acme/acme-model-1", 0.5, 0.5)},
        )
        write_catalog(
            tmp_path,
            "llmModels.overlay.json",
            {"acme/acme-model-1": model("acme/acme-model-1", 0.001, 0.002)},
        )
        monkeypatch.setenv(PRICING_DIR_ENV, str(tmp_path))

        assert register_langwatch_model_pricing() == 1
        entry = litellm.model_cost["acme/acme-model-1"]
        assert entry["input_cost_per_token"] == 0.001
        assert entry["output_cost_per_token"] == 0.002

    def test_the_app_catalog_prices_a_known_model(self, monkeypatch):
        monkeypatch.delenv(PRICING_DIR_ENV, raising=False)
        directory = pricing_dir()
        assert directory is not None, "the app catalog should be found in a checkout"
        pricing = load_catalog(directory)["openai/gpt-5-mini"]["pricing"]

        assert register_langwatch_model_pricing() > 100
        prompt, completion = cost_per_token(
            model="openai/gpt-5-mini", prompt_tokens=1000, completion_tokens=1000
        )

        assert prompt == pricing["inputCostPerToken"] * 1000
        assert completion == pricing["outputCostPerToken"] * 1000


class TestOfflineDefaults:
    def run(self, env):
        code = (
            "import os, langevals_core.offline_defaults;"
            "print(os.environ['LITELLM_LOCAL_MODEL_COST_MAP'], os.environ['RAGAS_DO_NOT_TRACK'])"
        )
        return subprocess.run(
            [sys.executable, "-c", code],
            env={**os.environ, **env},
            capture_output=True,
            text=True,
            check=True,
        ).stdout.split()

    def test_never_downloads_the_litellm_price_list(self):
        assert self.run({"LITELLM_LOCAL_MODEL_COST_MAP": "False"})[0] == "True"

    def test_ragas_analytics_are_off_unless_opted_in(self):
        env = {k: v for k, v in os.environ.items() if k != "RAGAS_DO_NOT_TRACK"}
        code = (
            "import os, langevals_core.offline_defaults;"
            "print(os.environ['RAGAS_DO_NOT_TRACK'])"
        )
        default = subprocess.run(
            [sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True
        ).stdout.strip()

        assert default == "true"
        assert self.run({"RAGAS_DO_NOT_TRACK": "false"})[1] == "false"
