import os
from tempfile import mkdtemp
from typing import Optional
import warnings
import litellm
import litellm.cost_calculator
from openai import OpenAI, AzureOpenAI
import json

from langevals_core.request_env import current_request_env

# Necessary for running DSPy on AWS lambdas
os.environ["DSP_CACHEDIR"] = mkdtemp()
os.environ["DSPY_CACHEDIR"] = mkdtemp()

# An operator configuring azure on the server environment may use either the
# AZURE_OPENAI_* names or litellm's AZURE_API_* names; litellm only reads its
# own. Alias the SERVER environment once at import, both ways. Request
# credentials never pass through here: they stay in the request context and
# reach litellm as call arguments, where `request_credentials` accepts both
# spellings itself.
def _alias_baseline_azure_env() -> None:
    aliases = [
        ("AZURE_OPENAI_API_KEY", "AZURE_API_KEY"),
        ("AZURE_OPENAI_ENDPOINT", "AZURE_API_BASE"),
    ]
    for openai_name, litellm_name in aliases:
        if os.environ.get(openai_name) and not os.environ.get(litellm_name):
            os.environ[litellm_name] = os.environ[openai_name]
        if os.environ.get(litellm_name) and not os.environ.get(openai_name):
            os.environ[openai_name] = os.environ[litellm_name]


_alias_baseline_azure_env()

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


# The request env vars that resolve into litellm call arguments, by the
# model's provider prefix. This is how a request's credentials reach the call
# without anyone writing os.environ: the names mirror what litellm itself
# reads from the environment, so behavior is unchanged for credentials that
# live in the server's own environment (litellm still falls back to those on
# its own). Azure accepts both its litellm names and the AZURE_OPENAI_* names
# the platform sends; first present wins.
PROVIDER_CREDENTIAL_VARS = {
    "openai": {
        "api_key": ["OPENAI_API_KEY"],
        "api_base": ["OPENAI_BASE_URL"],
    },
    "azure": {
        "api_key": ["AZURE_API_KEY", "AZURE_OPENAI_API_KEY"],
        "api_base": ["AZURE_API_BASE", "AZURE_OPENAI_ENDPOINT"],
        "api_version": ["AZURE_API_VERSION"],
    },
    "anthropic": {"api_key": ["ANTHROPIC_API_KEY"]},
    "groq": {"api_key": ["GROQ_API_KEY"]},
    "gemini": {"api_key": ["GEMINI_API_KEY"]},
    "vertex_ai": {"vertex_credentials": ["GOOGLE_APPLICATION_CREDENTIALS"]},
    # A request carrying its own AWS credentials names them the way the
    # provider form stores them. The session token is here for temporary
    # credentials: an assumed role gives all three, and access key with secret
    # alone is rejected.
    "bedrock": {
        "aws_access_key_id": ["AWS_ACCESS_KEY_ID"],
        "aws_secret_access_key": ["AWS_SECRET_ACCESS_KEY"],
        "aws_session_token": ["AWS_SESSION_TOKEN"],
        "aws_region_name": ["AWS_REGION_NAME"],
    },
}


def _model_provider(model: str) -> str:
    # litellm treats a bare model name (no provider prefix) as openai.
    return model.split("/", 1)[0] if "/" in model else "openai"


def azure_api_version(model: str, api_version: str) -> dict:
    """The api_version call argument for an azure model, empty for any other.

    Evaluators used to pin their azure API version by writing AZURE_API_VERSION
    into os.environ; as a call argument the pin stays with the one call it
    belongs to. A request's X_LITELLM_api_version still overrides it, the same
    precedence the environment write had.
    """
    return {"api_version": api_version} if model.startswith("azure/") else {}


def request_credentials(kwargs: dict) -> None:
    """Resolve the running evaluation's env into explicit call arguments.

    Explicit arguments already on the call are kept: an evaluator that names
    its own api_version, or a test that injects a client, always wins. The
    request env fills the gaps, and whatever the request does not carry is
    left for litellm to resolve from the server's own environment, which is
    exactly where non-request credentials live.
    """
    env = current_request_env()
    if not env:
        return
    provider_vars = PROVIDER_CREDENTIAL_VARS.get(
        _model_provider(kwargs.get("model") or ""), {}
    )
    for argument, var_names in provider_vars.items():
        if kwargs.get(argument) is not None:
            continue
        for var_name in var_names:
            if env.get(var_name):
                kwargs[argument] = env[var_name]
                break


def patch_litellm_params(kwargs):
    kwargs["drop_params"] = True
    # Caching on disk is timing out for some reason, disable it
    kwargs["cache"] = {"no-cache": True, "no-store": True}

    request_env = current_request_env()

    request_credentials(kwargs)

    # The server environment is the fallback for vertex, after the request env
    # had its turn through the table above and only when the caller named
    # nothing. Reading it for any other provider would attach credentials that
    # the call has no use for.
    if (
        kwargs.get("vertex_credentials") is None
        and _model_provider(kwargs.get("model") or "") == "vertex_ai"
    ):
        google_credentials = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if google_credentials is not None:
            kwargs["vertex_credentials"] = google_credentials

    # X_LITELLM_* variables are litellm call arguments by name. The server's
    # own environment provides the baseline and the request env overrides it,
    # the same precedence get_env gives every other variable.
    for key, value in {**os.environ, **request_env}.items():
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
    deployment_name = request_env.get("AZURE_DEPLOYMENT_NAME") or os.environ.get(
        "AZURE_DEPLOYMENT_NAME"
    )
    if (
        deployment_name is not None
        and "model" in kwargs
        and kwargs["model"].startswith("azure/")
    ):
        kwargs["model"] = "azure/" + deployment_name

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


def patch_litellm_embedding_params(kwargs):
    kwargs["drop_params"] = True

    request_env = current_request_env()

    embeddings_deployment = request_env.get(
        "AZURE_EMBEDDINGS_DEPLOYMENT_NAME"
    ) or os.environ.get("AZURE_EMBEDDINGS_DEPLOYMENT_NAME")
    if embeddings_deployment is not None:
        kwargs["model"] = "azure/" + embeddings_deployment

    request_credentials(kwargs)

    for key, value in {**os.environ, **request_env}.items():
        if key.startswith("X_LITELLM_EMBEDDINGS_"):
            replaced_key = key.replace("X_LITELLM_EMBEDDINGS_", "")
            # check if key is all uppercase, likely not a litellm key and got here by accident
            if replaced_key.isupper():
                continue
            kwargs[replaced_key] = convert_param_type(replaced_key, value)

    if "extra_headers" in kwargs and isinstance(kwargs["extra_headers"], str):
        kwargs["extra_headers"] = json.loads(kwargs["extra_headers"])

    return kwargs


# The unpatched litellm entry points. Tests replace these to capture the
# final call arguments after every patch above has been applied; nothing else
# should touch them.
originals: dict = {}


def patch_litellm():
    if originals:
        return
    originals["completion"] = litellm.completion
    originals["acompletion"] = litellm.acompletion
    originals["embedding"] = litellm.embedding
    originals["completion_cost"] = litellm.cost_calculator.completion_cost

    def patched_completion(*args, **kwargs):
        kwargs = patch_litellm_params(kwargs)

        try:
            return originals["completion"](*args, **kwargs)
        except Exception as exception:
            conflict = tool_reasoning_conflict(kwargs, exception)
            if conflict is not None:
                raise conflict from exception
            raise

    litellm.completion = patched_completion

    async def patched_acompletion(*args, **kwargs):
        kwargs = patch_litellm_params(kwargs)

        try:
            return await originals["acompletion"](*args, **kwargs)
        except Exception as exception:
            conflict = tool_reasoning_conflict(kwargs, exception)
            if conflict is not None:
                raise conflict from exception
            raise

    litellm.acompletion = patched_acompletion

    def patched_embedding(*args, **kwargs):
        kwargs = patch_litellm_embedding_params(kwargs)
        return originals["embedding"](*args, **kwargs)

    litellm.embedding = patched_embedding

    # Fail silently if completion_cost fails
    def patched_completion_cost(*args, **kwargs):
        try:
            return originals["completion_cost"](*args, **kwargs)
        except Exception as e:
            warnings.warn(f"Failed to calculate completion_cost: {e}")
            return None

    litellm.cost_calculator.completion_cost = patched_completion_cost
