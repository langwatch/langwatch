import os
from tempfile import mkdtemp
import warnings
import litellm
import litellm.cost_calculator
from openai import OpenAI, AzureOpenAI
import json

# Necessary for running DSPy on AWS lambdas
os.environ["DSP_CACHEDIR"] = mkdtemp()
os.environ["DSPY_CACHEDIR"] = mkdtemp()

# Parameters that need type conversion from string env vars
INT_PARAMS = {"max_tokens", "seed", "n", "top_logprobs", "max_completion_tokens"}
FLOAT_PARAMS = {"temperature", "top_p", "frequency_penalty", "presence_penalty"}


def convert_param_type(key: str, value: str):
    """Convert string env var value to proper type for litellm params."""
    if key in INT_PARAMS:
        try:
            return int(value)
        except ValueError:
            return value
    elif key in FLOAT_PARAMS:
        try:
            return float(value)
        except ValueError:
            return value
    return value


# Patch litellm completion for mapping AZURE_DEPLOYMENT_NAME into the model name
def patch_litellm():
    _original_completion = litellm.completion

    def patch_litellm_params(kwargs):
        kwargs["drop_params"] = True
        # Caching on disk is timing out for some reason, disable it
        kwargs["cache"] = {"no-cache": True, "no-store": True}

        if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") is not None:
            kwargs["vertex_credentials"] = os.environ["GOOGLE_APPLICATION_CREDENTIALS"]

        for key, value in os.environ.items():
            if key.startswith("X_LITELLM_") and not key.startswith(
                "X_LITELLM_EMBEDDINGS_"
            ):
                replaced_key = key.replace("X_LITELLM_", "")
                # check if key is all uppercase, likely not a litellm key and got here by accident
                if replaced_key.isupper():
                    continue
                kwargs[replaced_key] = convert_param_type(replaced_key, value)

        if "extra_headers" in kwargs and isinstance(kwargs["extra_headers"], str):
            kwargs["extra_headers"] = json.loads(kwargs["extra_headers"])

        # Azure patches
        if (
            os.environ.get("AZURE_DEPLOYMENT_NAME") is not None
            and "model" in kwargs
            and kwargs["model"].startswith("azure/")
        ):
            kwargs["model"] = "azure/" + os.environ["AZURE_DEPLOYMENT_NAME"]

        if "use_azure_gateway" in kwargs:
            kwargs["model"] = kwargs["model"].replace("azure/", "")

            if "/openai/" in kwargs["api_base"]:
                if not kwargs["api_base"].endswith("/"):
                    kwargs["api_base"] += "/"

                if "/deployments" not in kwargs["api_base"]:
                    kwargs["api_base"] += "deployments/"

                kwargs["api_base"] += kwargs["model"]

            kwargs["client"] = OpenAI(
                base_url=kwargs["api_base"],
                default_query={"api-version": kwargs["api_version"]},
            )

            del kwargs["api_base"]
            del kwargs["use_azure_gateway"]

        return kwargs

    def patched_completion(*args, **kwargs):
        kwargs = patch_litellm_params(kwargs)

        return _original_completion(*args, **kwargs)

    litellm.completion = patched_completion

    _original_acompletion = litellm.acompletion

    def patched_acompletion(*args, **kwargs):
        kwargs = patch_litellm_params(kwargs)

        return _original_acompletion(*args, **kwargs)

    litellm.acompletion = patched_acompletion

    _original_embedding = litellm.embedding

    def patched_embedding(*args, **kwargs):
        kwargs["drop_params"] = True
        if os.environ.get("AZURE_EMBEDDINGS_DEPLOYMENT_NAME") is not None:
            kwargs["model"] = "azure/" + os.environ["AZURE_EMBEDDINGS_DEPLOYMENT_NAME"]
        # if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") is not None:
        #     kwargs["vertex_credentials"] = os.environ["GOOGLE_APPLICATION_CREDENTIALS"]
        for key, value in os.environ.items():
            if key.startswith("X_LITELLM_EMBEDDINGS_"):
                replaced_key = key.replace("X_LITELLM_EMBEDDINGS_", "")
                # check if key is all uppercase, likely not a litellm key and got here by accident
                if replaced_key.isupper():
                    continue
                kwargs[replaced_key] = convert_param_type(replaced_key, value)
        return _original_embedding(*args, **kwargs)

    litellm.embedding = patched_embedding

    _original_completion_cost = litellm.cost_calculator.completion_cost

    # Fail silently if completion_cost fails
    def patched_completion_cost(*args, **kwargs):
        try:
            return _original_completion_cost(*args, **kwargs)
        except Exception as e:
            warnings.warn(f"Failed to calculate completion_cost: {e}")
            return None

    litellm.cost_calculator.completion_cost = patched_completion_cost
