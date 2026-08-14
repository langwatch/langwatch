import os
from tempfile import mkdtemp
from typing import Optional
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

# The parameter a provider names when the reasoning setting is what it refused.
REASONING_EFFORT_PARAM = "reasoning_effort"

# The value that switches reasoning off.
REASONING_OFF = "none"

# `/v1/chat/completions` refuses a request carrying function tools on these
# models unless reasoning is switched off explicitly: "Function tools with
# reasoning_effort are not supported for <model> in /v1/chat/completions. To use
# function tools, use /v1/responses or set reasoning_effort to 'none'." Nearly
# every LLM-as-judge evaluator here asks for its verdict through a function
# tool, so on such a model no evaluation reaches a verdict at all.
#
# An exact allowlist rather than a pattern, because the family boundary is not
# where the behavior changes: openai/gpt-5.6-sol-pro, azure/gpt-5.6-sol and
# openai/gpt-5.5-sol all accept the combination, and some reasoning models
# refuse to run with their reasoning off at all. A model joins this set once it
# has actually been observed to need it.
TOOL_REASONING_INCOMPATIBLE_MODELS = frozenset(
    {
        "openai/gpt-5.6-luna",
        "openai/gpt-5.6-sol",
        "openai/gpt-5.6-terra",
    }
)


class ToolReasoningConflictError(Exception):
    """
    A model refused a request carrying function tools because of its reasoning
    setting.

    The message is written for the person configuring the evaluator: it names
    their own model and the setting to change, and leaves the provider's own
    wording out, which talks about endpoints they do not choose.
    """

    def __init__(self, model: Optional[str] = None):
        subject = f"The evaluator model {model}" if model else "The evaluator model"
        super().__init__(
            f"{subject} does not accept function tools while its reasoning is "
            f"on, and this evaluator asks for its verdict through a function "
            f"call. Choose a different evaluator model, or set its reasoning "
            f"effort to '{REASONING_OFF}'."
        )
        self.model = model


def tool_reasoning_conflict(
    kwargs: dict, exception: BaseException
) -> Optional[ToolReasoningConflictError]:
    """
    The error to report in place of a provider rejection that is the
    tools-versus-reasoning conflict, or None when the rejection is something
    else and belongs to the caller untouched.

    Three signals, and all are required: the request carried tools, the
    rejection names the reasoning parameter, and the rejection is about tools.
    Any of them alone also describes ordinary rejections that have nothing to
    do with this, such as an unsupported reasoning value on a request that
    asked for no tools at all.
    """
    if not kwargs.get("tools"):
        return None

    message = str(exception).lower()
    if REASONING_EFFORT_PARAM not in message or "tool" not in message:
        return None

    return ToolReasoningConflictError(kwargs.get("model"))


def apply_tool_reasoning_compatibility(kwargs: dict) -> dict:
    """
    Switch reasoning off for the models that reject function tools while it is
    on, so a judge call reaches a verdict instead of a 400.

    A default and never an override, on three counts. A caller that asked for a
    specific reasoning effort keeps it and gets the provider's own answer
    rather than having its intent silently rewritten. A request carrying no
    tools is left alone, since the incompatibility is only about tools and
    reasoning is worth having on the calls that can use it. And a model outside
    the allowlist is left alone, since disabling reasoning is itself rejected by
    models that only work with it on.
    """
    if kwargs.get(REASONING_EFFORT_PARAM) is not None:
        return kwargs
    if not kwargs.get("tools"):
        return kwargs
    if kwargs.get("model") not in TOOL_REASONING_INCOMPATIBLE_MODELS:
        return kwargs

    kwargs[REASONING_EFFORT_PARAM] = REASONING_OFF
    return kwargs


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

        # Last, so that an operator's X_LITELLM_reasoning_effort counts as an
        # explicit choice and the azure rewrites above have already settled
        # which model the request actually names.
        kwargs = apply_tool_reasoning_compatibility(kwargs)

        return kwargs

    def patched_completion(*args, **kwargs):
        kwargs = patch_litellm_params(kwargs)

        try:
            return _original_completion(*args, **kwargs)
        except Exception as exception:
            conflict = tool_reasoning_conflict(kwargs, exception)
            if conflict is not None:
                raise conflict from exception
            raise

    litellm.completion = patched_completion

    _original_acompletion = litellm.acompletion

    async def patched_acompletion(*args, **kwargs):
        kwargs = patch_litellm_params(kwargs)

        try:
            return await _original_acompletion(*args, **kwargs)
        except Exception as exception:
            conflict = tool_reasoning_conflict(kwargs, exception)
            if conflict is not None:
                raise conflict from exception
            raise

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

        if "extra_headers" in kwargs and isinstance(kwargs["extra_headers"], str):
            kwargs["extra_headers"] = json.loads(kwargs["extra_headers"])

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
