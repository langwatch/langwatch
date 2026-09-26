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


# Models seen refusing a forced tool_choice in this process, so later calls go
# straight to "auto" instead of paying a refused round trip first.
# Example: bedrock/global.anthropic.claude-opus-5-5 refuses it on every call.
forced_tool_choice_refusers: set[str] = set()

# Sent after an "auto" answer that skipped the function the evaluator forced.
TOOL_CALL_REMINDER = (
    "Answer only by calling the `{name}` function, with every required field."
)


def is_forced_tool_choice(tool_choice) -> bool:
    if isinstance(tool_choice, dict):
        return True
    return tool_choice in ("required", "any")


def forced_tool_name(kwargs: dict) -> Optional[str]:
    """The one function a forced tool_choice names, or None for "any tool"."""
    tool_choice = kwargs.get("tool_choice")
    if isinstance(tool_choice, dict):
        function = tool_choice.get("function") or {}
        return function.get("name") or tool_choice.get("name")
    tools = kwargs.get("tools") or []
    if len(tools) == 1:
        return (tools[0].get("function") or {}).get("name")
    return None


def forced_tool_choice_refused(kwargs: dict, exception: BaseException) -> bool:
    """Whether the provider refused a tool_choice that forces a function:
    Claude Opus 5.5 always ('tool_choice: type "tool" and "any" are not
    supported'), Claude with thinking on ("...when tool_choice forces tool use")."""
    if not kwargs.get("tools") or not is_forced_tool_choice(kwargs.get("tool_choice")):
        return False
    message = str(exception).lower()
    if "tool_choice" not in message:
        return False
    return any(
        marker in message
        for marker in ("not supported", "thinking", "forces tool use", "not compatible")
    )


def calls_tool(response, name: Optional[str]) -> bool:
    try:
        tool_calls = response.choices[0].message.tool_calls or []
    except (AttributeError, IndexError, TypeError):
        return False
    if name is None:
        return len(tool_calls) > 0
    return any(getattr(call.function, "name", None) in (name, None) for call in tool_calls)


def auto_tool_choice_attempts(kwargs: dict):
    """The retries once a forced tool_choice is refused: tool_choice "auto",
    then, if that answer skipped the function, once more with a reminder.
    Callers stop at the first answer that calls the function."""
    relaxed = {**kwargs, "tool_choice": "auto"}
    yield relaxed
    reminder = {
        "role": "user",
        "content": TOOL_CALL_REMINDER.format(name=forced_tool_name(kwargs) or "provided"),
    }
    yield {**relaxed, "messages": [*(kwargs.get("messages") or []), reminder]}


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


# The gpt-5 models that DO accept a temperature, so the family test does not
# claim them: the image models take one, the text models do not
# (`modules/model-provider/contract/src/catalog/model-catalog.json`
# is the catalogue this was read from — 46 of the family refuse, these two accept).
#
# The exceptions are listed rather than inverting this into an allowlist of the
# 46, because the two errors are not symmetric. Pinning a model that would have
# accepted 0 costs one evaluator its determinism; missing a model that refuses
# fails the call outright and the evaluation reaches no verdict at all. New
# refusing models also appear far more often than new accepting ones, so the
# list that needs no maintenance is this one.
TEMPERATURE_UNRESTRICTED_MODEL_NAMES = frozenset(
    {
        "gpt-5-image",
        "gpt-5-image-mini",
    }
)


def is_temperature_pinned_model(model: Optional[str]) -> bool:
    """
    Whether this model accepts only its default temperature.

    Matched on the name after the provider prefix, so `openai/gpt-5-mini` and
    `azure/gpt-5-mini` answer alike.
    """
    if not model:
        return False
    name = model.split("/")[-1]
    if name in TEMPERATURE_UNRESTRICTED_MODEL_NAMES:
        return False
    return "gpt-5" in name


def apply_gpt5_temperature_compatibility(
    kwargs: dict, requested_model: Optional[str] = None
) -> dict:
    """
    Pin temperature to the default for the gpt-5-family models that accept only
    that value and reject every other with a BadRequestError ("'temperature'
    does not support 0.0 with this model. Only the default (1) value is
    supported.").

    drop_params cannot cover this: it strips parameters a model does not
    support at all, and these models do support temperature — they restrict
    its value. Evaluators default to temperature 0 for deterministic
    verdicts, so without this a gpt-5 judge call fails before it starts.
    Applied centrally so every evaluator and every user-configured judge
    model gets it, not only the two that carry their own guard
    (llm_answer_match, select_best_compare).

    This one IS an override, unlike apply_tool_reasoning_compatibility above:
    there, a caller's stated reasoning effort is a choice the provider can
    honor, so it is left to answer for itself. Here the stated value is one
    the provider will refuse outright, so keeping it only converts a verdict
    into a 400. The cost is real and belongs in the open — a judge on such a
    model does not run at temperature 0, so its verdicts are not reproducible
    the way the evaluator's default intends.

    `requested_model` is the model the request named before any Azure
    deployment rewrite, since a deployment's arbitrary name ("prod-judge")
    carries nothing to recognise the family by.
    """
    if not (
        is_temperature_pinned_model(kwargs.get("model"))
        or is_temperature_pinned_model(requested_model)
    ):
        return kwargs
    if kwargs.get("temperature") in (None, 1, 1.0):
        return kwargs
    kwargs["temperature"] = 1.0
    return kwargs


def is_claude_model(model: Optional[str]) -> bool:
    """
    Whether this model is an Anthropic Claude model, on any route.

    Matched anywhere in the string rather than after the provider prefix,
    because the routes disagree about where the name sits:
    `anthropic/claude-sonnet-4-5`, `bedrock/anthropic.claude-sonnet-4-5-v1:0`,
    `vertex_ai/claude-sonnet-4-5` and a Bedrock inference-profile ARN all
    carry it differently. No other vendor names a model "claude".
    """
    return "claude" in model.lower() if model else False


def apply_anthropic_sampling_compatibility(kwargs: dict) -> dict:
    """
    Keep only one sampling parameter for Claude models, which reject a
    request naming both with a BadRequestError ("`temperature` and `top_p`
    cannot both be specified for this model. Please use only one.").

    drop_params cannot cover this either: each parameter is supported on its
    own — the model restricts the combination. The temperature is the one
    kept, because evaluators default to temperature 0 for deterministic
    verdicts, so it is the knob their determinism actually lives in; a top_p
    riding alongside it is the one whose absence changes a verdict least.

    Applied to every Claude model rather than only the generations known to
    refuse, on the same asymmetry as the gpt-5 list above: dropping a top_p
    from a call that also names a temperature costs almost nothing on a
    model that would have accepted both, while keeping it fails the call
    outright and the evaluation reaches no verdict at all.
    """
    if not is_claude_model(kwargs.get("model")):
        return kwargs
    if kwargs.get("temperature") is None or kwargs.get("top_p") is None:
        return kwargs
    del kwargs["top_p"]
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

    # Azure patches. Kept before the rewrite: a deployment name is arbitrary
    # ("prod-judge"), so after this block there is nothing left in the model
    # string to recognise a family by.
    requested_model = kwargs.get("model")
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
    # Same position for the same reason: the model name is now final, and an
    # explicit X_LITELLM_temperature has landed — a value the model refuses
    # is normalized rather than sent to fail.
    kwargs = apply_gpt5_temperature_compatibility(
        kwargs, requested_model=requested_model
    )
    # Same position again: both sampling knobs have landed by now, wherever
    # each came from — an evaluator argument or a request's X_LITELLM_*
    # setting — so this is the first point the conflict is even visible.
    kwargs = apply_anthropic_sampling_compatibility(kwargs)

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

    def complete_with_auto_tool_choice(args, kwargs):
        name = forced_tool_name(kwargs)
        response = None
        for attempt in auto_tool_choice_attempts(kwargs):
            response = originals["completion"](*args, **attempt)
            if calls_tool(response, name):
                break
        return response

    async def acomplete_with_auto_tool_choice(args, kwargs):
        name = forced_tool_name(kwargs)
        response = None
        for attempt in auto_tool_choice_attempts(kwargs):
            response = await originals["acompletion"](*args, **attempt)
            if calls_tool(response, name):
                break
        return response

    def patched_completion(*args, **kwargs):
        kwargs = patch_litellm_params(kwargs)

        try:
            if kwargs.get("model") in forced_tool_choice_refusers and is_forced_tool_choice(
                kwargs.get("tool_choice")
            ):
                return complete_with_auto_tool_choice(args, kwargs)
            try:
                return originals["completion"](*args, **kwargs)
            except Exception as exception:
                if not forced_tool_choice_refused(kwargs, exception):
                    raise
                forced_tool_choice_refusers.add(kwargs.get("model"))
                return complete_with_auto_tool_choice(args, kwargs)
        except Exception as exception:
            conflict = tool_reasoning_conflict(kwargs, exception)
            if conflict is not None:
                raise conflict from exception
            raise

    litellm.completion = patched_completion

    async def patched_acompletion(*args, **kwargs):
        kwargs = patch_litellm_params(kwargs)

        try:
            if kwargs.get("model") in forced_tool_choice_refusers and is_forced_tool_choice(
                kwargs.get("tool_choice")
            ):
                return await acomplete_with_auto_tool_choice(args, kwargs)
            try:
                return await originals["acompletion"](*args, **kwargs)
            except Exception as exception:
                if not forced_tool_choice_refused(kwargs, exception):
                    raise
                forced_tool_choice_refusers.add(kwargs.get("model"))
                return await acomplete_with_auto_tool_choice(args, kwargs)
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
