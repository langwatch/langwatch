import ast
import builtins
from contextlib import contextmanager
import inspect
import json
import keyword
import os
import re
import sys
import threading
import random
import enum

from typing import Any, Dict, Iterator, List, Optional, cast
from joblib.memory import MemorizedFunc, AsyncMemorizedFunc
import langwatch
import litellm


from langwatch_nlp.studio.types.dsl import (
    DatasetInline,
    Entry,
    EntryNode,
    LLMConfig,
    Node,
    Workflow,
)
import dspy
from pydantic import BaseModel


from langwatch_nlp.studio.types.dataset import DatasetColumn, DatasetColumnType


def print_class_definition(cls):
    print(
        f"class {cls.__name__}({', '.join(base.__name__ for base in cls.__bases__)}):"
    )

    # Print docstring if it exists
    if cls.__doc__:
        print(f'    """{cls.__doc__}"""')

    # Print class attributes
    for name, value in cls.__dict__.items():
        if (
            not name.startswith("__")
            and not inspect.isfunction(value)
            and not inspect.ismethod(value)
        ):
            print(f"    {name} = {repr(value)}")

    # Print methods
    for name, value in cls.__dict__.items():
        if inspect.isfunction(value) or inspect.ismethod(value):
            signature = inspect.signature(value)
            print(f"    def {name}{signature}:")
            if value.__doc__:
                print(f'        """{value.__doc__}"""')
            print("        pass")

    print()  # Add a blank line at the end


def disable_dsp_caching():
    MemorizedFunc._is_in_cache_and_valid = lambda *args, **kwargs: False
    AsyncMemorizedFunc._is_in_cache_and_valid = lambda *args, **kwargs: False
    litellm.cache = None
    dspy.configure_cache(enable_memory_cache=False, enable_disk_cache=False)


def set_dspy_cache_dir(cache_dir: str, limit_size=1e9):  # 1 GB
    from litellm.caching.caching import Cache, LiteLLMCacheType

    os.environ["DSPY_CACHEDIR"] = cache_dir
    os.environ["DSPY_CACHE_LIMIT"] = str(limit_size)

    litellm.cache = Cache(disk_cache_dir=cache_dir, type=LiteLLMCacheType.DISK)

    if litellm.cache.cache.disk_cache.size_limit != limit_size:  # type: ignore
        litellm.cache.cache.disk_cache.reset("size_limit", limit_size)  # type: ignore


def print_ast(node):
    print("\n\n" + ast.unparse(node) + "\n\n")


def validate_identifier(identifier: str) -> str:
    """Validate and sanitize an identifier."""
    # Only allow alphanumeric characters and underscores, must start with a letter or underscore
    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", identifier):
        raise ValueError(f"Invalid identifier: {identifier}")
    # Check its also not a reserved word
    if (
        keyword.iskeyword(identifier)
        or identifier in dir(builtins)
        or identifier == "self"
    ):
        raise ValueError(f"Reserved identifier cannot be used: {identifier}")
    return identifier


def build_secrets_preamble(
    secrets: Optional[Dict[str, str]],
) -> str:
    """Build a Python code preamble that injects a ``secrets`` namespace.

    Instead of doing regex-based text replacement on the user's code, this
    generates a small preamble that defines ``secrets`` as a namespace object
    with each secret as an attribute.  This way ``secrets.MY_API_KEY`` is
    valid Python attribute access with proper syntax highlighting.

    Args:
        secrets: A mapping of secret names to their plain-text values. May be
            ``None`` if no secrets were provided.

    Returns:
        A Python code snippet to prepend to the user's code. Returns an empty
        string when there are no secrets.
    """
    if not secrets:
        return ""

    # Use repr() for proper Python string literal escaping.
    assignments = ", ".join(
        f"{name}={repr(value)}" for name, value in secrets.items()
    )
    return (
        "from types import SimpleNamespace as _SecretsNS\n"
        f"secrets = _SecretsNS({assignments})\n\n"
    )


def transpose_inline_dataset_to_object_list(
    dataset: DatasetInline,
) -> List[Dict[str, Any]]:
    columns = dataset.records

    lengths = [len(values) for values in columns.values()]
    if len(lengths) == 0:
        return []
    max_length = max(lengths)

    result: List[Dict[str, Any]] = []

    for i in range(max_length):
        row: Dict[str, Any] = {}
        for column_name, values in columns.items():
            row[column_name] = values[i] if i < len(values) else None
        result.append(row)

    return result


def get_node_by_id(workflow: Workflow, node_id: str) -> Node:
    return next(node for node in workflow.nodes if node.id == node_id)


def get_input_keys(workflow: Workflow) -> List[str]:
    entry_node = cast(
        EntryNode, next(node for node in workflow.nodes if isinstance(node.data, Entry))
    )
    input_keys = set()
    for edge in workflow.edges:
        if (
            edge.source == entry_node.id
            and edge.sourceHandle.split(".")[-1] not in input_keys
            # and get_node_by_id(workflow, edge.target).type != "evaluator"
        ):
            input_keys.add(edge.sourceHandle.split(".")[-1])

    return list(input_keys)


def get_output_keys(workflow: Workflow) -> List[str]:
    entry_node = cast(
        EntryNode, next(node for node in workflow.nodes if isinstance(node.data, Entry))
    )
    output_keys = set()
    for edge in workflow.edges:
        if (
            edge.source == entry_node.id
            and edge.sourceHandle.split(".")[-1] not in output_keys
            and (
                get_node_by_id(workflow, edge.target).type == "evaluator"
                or get_node_by_id(workflow, edge.target).data.behave_as == "evaluator"
            )
        ):
            output_keys.add(edge.sourceHandle.split(".")[-1])

    return list(output_keys)


class ClientReadableValueError(ValueError):
    def __repr__(self) -> str:
        return self.args[0]


# Minimum max_tokens required by DSPy for reasoning models
REASONING_MODEL_MIN_MAX_TOKENS = 16000

# ============================================================================
# Provider Parameter Constraints
# ============================================================================
# Mirrors registry.ts modelProviders.parameterConstraints
# These constraints are provider-level limits that override global defaults.

PROVIDER_PARAMETER_CONSTRAINTS: Dict[str, Dict[str, Dict[str, float]]] = {
    "anthropic": {
        "temperature": {"min": 0, "max": 1},
    },
}


def get_provider_from_model_id(model_id: str | None) -> str | None:
    """
    Extract provider from model ID.

    Args:
        model_id: Full model ID (e.g., "anthropic/claude-sonnet-4")

    Returns:
        Provider name (e.g., "anthropic") or None if not found
    """
    if not model_id or "/" not in model_id:
        return None
    return model_id.split("/")[0]


def clamp_to_provider_constraints(
    value: float,
    param_name: str,
    model_id: str | None,
) -> float:
    """
    Clamps a parameter value to provider-specific constraints.

    This is a pure function for defense-in-depth validation.
    Even if the UI allows out-of-range values, this ensures
    the API receives valid values.

    Args:
        value: The parameter value to clamp
        param_name: Parameter name (e.g., "temperature")
        model_id: Full model ID (e.g., "anthropic/claude-sonnet-4")

    Returns:
        The clamped value within provider constraints, or original value
        if no constraints exist for this provider/parameter.
    """
    provider = get_provider_from_model_id(model_id)
    if not provider:
        return value

    constraints = PROVIDER_PARAMETER_CONSTRAINTS.get(provider, {})
    param_constraints = constraints.get(param_name, {})

    if not param_constraints:
        return value

    min_val = param_constraints.get("min", float("-inf"))
    max_val = param_constraints.get("max", float("inf"))

    return max(min_val, min(value, max_val))


# Translation map from provider-specific parameter names to LiteLLM's expected parameter.
# LiteLLM expects 'reasoning_effort' for all providers - it handles the internal
# transformation to provider-specific formats (e.g., Anthropic's output_config).
LITELLM_PARAMETER_TRANSLATION: Dict[str, str] = {
    "effort": "reasoning_effort",
    "thinkingLevel": "reasoning_effort",
    "reasoning_effort": "reasoning_effort",
}

# Provider-specific reasoning parameter fallbacks.
# All providers now use 'reasoning_effort' because LiteLLM expects it.
PROVIDER_REASONING_FALLBACKS: Dict[str, str] = {
    "openai": "reasoning_effort",
    "google": "reasoning_effort",
    "anthropic": "reasoning_effort",
    "gemini": "reasoning_effort",
}


def get_provider_from_model(model: str | None) -> str:
    """Extract provider from model string (e.g., 'openai/gpt-4' -> 'openai')."""
    if not model:
        return ""
    return model.split("/")[0].lower() if "/" in model else ""


# Model aliases that need expansion to their full dated versions.
# LiteLLM requires the full dated version for certain models.
MODEL_ALIASES: Dict[str, str] = {
    "anthropic/claude-sonnet-4": "anthropic/claude-sonnet-4-20250514",
    "anthropic/claude-opus-4": "anthropic/claude-opus-4-20250514",
    "anthropic/claude-3.5-haiku": "anthropic/claude-3-5-haiku-20241022",
}

# Providers that need dot-to-dash translation for their model IDs.
# Anthropic models use dots in llmModels.json but LiteLLM expects dashes.
PROVIDERS_NEEDING_TRANSLATION = {"anthropic", "custom"}


def translate_model_id_for_litellm(model_id: str | None) -> str | None:
    """
    Translates a model ID for use with LiteLLM.

    First checks for exact alias matches that need expansion to dated versions.
    Then converts dots to dashes in model IDs for providers that need it (Anthropic, custom).
    Other providers (OpenAI, Gemini, etc.) are returned unchanged.

    Args:
        model_id: The model ID from llmModels.json (e.g., "anthropic/claude-opus-4.5")

    Returns:
        The translated model ID for LiteLLM (e.g., "anthropic/claude-opus-4-5")
    """
    if not model_id:
        return model_id

    # First, check for exact alias matches that need expansion
    if model_id in MODEL_ALIASES:
        return MODEL_ALIASES[model_id]

    provider = get_provider_from_model(model_id)

    # Only translate providers that need it
    # Models without a provider prefix are treated as needing translation
    # (they could be Anthropic models referenced without the prefix)
    needs_translation = provider == "" or provider in PROVIDERS_NEEDING_TRANSLATION

    if not needs_translation:
        return model_id

    # Replace dots with dashes in the entire model ID
    return model_id.replace(".", "-")


def translate_to_litellm_param(param_name: str) -> str:
    """
    Translates a parameter name to LiteLLM's expected format.

    Args:
        param_name: The parameter name (may be provider-specific like 'effort' or 'thinkingLevel')

    Returns:
        The translated parameter name for LiteLLM (always 'reasoning_effort' for known params)
    """
    return LITELLM_PARAMETER_TRANSLATION.get(param_name, param_name)


def map_reasoning_to_provider(model: str | None, reasoning: str | None) -> Dict[str, str]:
    """
    Maps the unified 'reasoning' field to LiteLLM's expected parameter.

    IMPORTANT: LiteLLM expects 'reasoning_effort' for ALL providers. This function
    always returns reasoning_effort regardless of the provider.

    LiteLLM internally transforms reasoning_effort to provider-specific formats:
    - Anthropic: reasoning_effort -> output_config={"effort": ...} + beta header
    - Gemini: reasoning_effort -> thinking_level or thinking with budget
    - OpenAI: reasoning_effort -> passed as-is

    Args:
        model: The model identifier (e.g., "openai/gpt-5", "gemini/gemini-3-flash")
        reasoning: The unified reasoning value

    Returns:
        Dict with { reasoning_effort: value }, or empty dict if reasoning is not set
    """
    if not reasoning:
        return {}

    # Always use reasoning_effort for LiteLLM - it handles provider-specific transforms
    return {"reasoning_effort": reasoning}


def normalize_reasoning_from_provider_fields(llm_config: LLMConfig) -> str | None:
    """
    Normalizes provider-specific reasoning fields to the unified 'reasoning' field.

    Priority order: reasoning > reasoning_effort > thinkingLevel > effort

    Args:
        llm_config: LLMConfig with potentially any combination of reasoning fields

    Returns:
        The normalized reasoning value, or None if none are set
    """
    return (
        llm_config.reasoning
        or llm_config.reasoning_effort
        or llm_config.thinkingLevel
        or llm_config.effort
    )


def has_reasoning_enabled(llm_config: LLMConfig) -> bool:
    """
    Check if reasoning/thinking is enabled for this config.

    When reasoning is enabled (via any of the reasoning fields), LiteLLM may
    auto-enable extended thinking with budget_tokens. If budget_tokens >= max_tokens,
    the Anthropic API returns an error. This function helps detect when we need
    to enforce a minimum max_tokens.

    Returns True if any reasoning field is set (reasoning, reasoning_effort,
    effort, or thinkingLevel).
    """
    return bool(
        llm_config.reasoning
        or llm_config.reasoning_effort
        or llm_config.effort
        or llm_config.thinkingLevel
    )


def _get_reasoning_max_tokens(config_max_tokens: int | None) -> int:
    """
    Ensure max_tokens >= REASONING_MODEL_MIN_MAX_TOKENS for reasoning models.

    Reasoning models (OpenAI o1/o3/gpt-5) and models with reasoning enabled
    (effort, thinkingLevel) require higher max_tokens to accommodate thinking
    budget tokens that LiteLLM may auto-set.
    """
    return max(
        config_max_tokens or REASONING_MODEL_MIN_MAX_TOKENS,
        REASONING_MODEL_MIN_MAX_TOKENS,
    )


def is_reasoning_model(model: str | None) -> bool:
    """
    Detects if a model is an OpenAI reasoning model (o1, o3, o4, o5, gpt-5).

    Uses the same detection logic as DSPy: extracts model family from path
    and matches against known reasoning model patterns.

    Reasoning models require temperature=1.0 and max_tokens >= 16000 for DSPy.
    """
    if not model:
        return False
    # Match DSPy's approach: extract model family and match pattern
    model_family = model.split("/")[-1].lower() if "/" in model else model.lower()
    return bool(re.match(r"^(?:o[1345]|gpt-5)(?:-(?:mini|nano))?", model_family))


def get_corrected_llm_params(llm_config: LLMConfig) -> dict[str, float | int]:
    """
    Returns corrected temperature and max_tokens for an LLMConfig.

    For OpenAI reasoning models (o1, o3, o4, o5, gpt-5):
    - temperature: 1.0 (required by DSPy, which handles the API call internally)
    - max_tokens: at least 16000

    For models with reasoning enabled (effort, reasoning, thinkingLevel):
    - temperature: config value or default, clamped to provider constraints
    - max_tokens: at least 16000 (LiteLLM may auto-enable extended thinking
      with budget_tokens that can exceed lower max_tokens values)

    For non-reasoning models:
    - temperature: config value or default, clamped to provider constraints
    - max_tokens: config value or 4096

    Provider constraints (e.g., Anthropic temperature max 1.0) are applied
    as defense-in-depth validation.
    """
    # OpenAI reasoning models require temperature=1.0 and min 16000 max_tokens
    if is_reasoning_model(llm_config.model):
        return {
            "temperature": 1.0,
            "max_tokens": _get_reasoning_max_tokens(llm_config.max_tokens),
        }

    # Get temperature with default, then clamp to provider constraints
    raw_temperature = (
        llm_config.temperature if llm_config.temperature is not None else 1
    )
    clamped_temperature = clamp_to_provider_constraints(
        raw_temperature, "temperature", llm_config.model
    )

    # Models with reasoning enabled need min 16000 max_tokens
    # LiteLLM may auto-enable extended thinking with budget_tokens that can
    # exceed lower max_tokens values, causing Anthropic API errors
    if has_reasoning_enabled(llm_config):
        return {
            "temperature": clamped_temperature,
            "max_tokens": _get_reasoning_max_tokens(llm_config.max_tokens),
        }

    return {
        # Use explicit None check to allow temperature=0 as a valid value
        # Default to 1 to match UI default (parameterRegistry temperature.default = 1)
        # Then clamp to provider constraints (e.g., Anthropic max 1.0)
        "temperature": clamped_temperature,
        # Default to 4096 to match UI default (parameterRegistry max_tokens.default = 4096)
        "max_tokens": llm_config.max_tokens if llm_config.max_tokens is not None else 4096,
    }


def node_llm_config_to_dspy_lm(llm_config: LLMConfig) -> dspy.LM:
    """
    Converts an LLMConfig to a DSPy LM instance.

    For reasoning models (o1, o3, o4, o5, gpt-5):
    - temperature: 1.0 (required by DSPy, which handles the API call internally)
    - max_tokens: at least 16000

    For non-reasoning models:
    - temperature: config value or 0
    - max_tokens: config value or 2048

    Reasoning parameter handling:
    - The unified 'reasoning' field is the canonical source
    - Provider-specific fields are checked for backward compatibility
    - The normalized value is mapped to the provider-specific parameter at runtime
    """
    llm_params: dict[str, Any] = llm_config.litellm_params or {
        "model": llm_config.model
    }

    # Translate model ID for LiteLLM (e.g., "anthropic/claude-opus-4.5" -> "anthropic/claude-opus-4-5")
    if llm_params.get("model"):
        llm_params["model"] = translate_model_id_for_litellm(llm_params["model"])

    if (
        "azure/" in (llm_params["model"] or "")
        and "api_version" not in llm_params
        and "use_azure_gateway" not in llm_params
    ):
        llm_params["api_version"] = os.environ["AZURE_API_VERSION"]
    llm_params["drop_params"] = True
    llm_params["model_type"] = "chat"

    corrected = get_corrected_llm_params(llm_config)

    # Build kwargs with corrected temperature and max_tokens
    dspy_kwargs: dict[str, Any] = {
        **llm_params,
        "max_tokens": corrected["max_tokens"],
        "temperature": corrected["temperature"],
    }

    # Pass optional sampling parameters if set
    if llm_config.top_p is not None:
        dspy_kwargs["top_p"] = llm_config.top_p
    if llm_config.frequency_penalty is not None:
        dspy_kwargs["frequency_penalty"] = llm_config.frequency_penalty
    if llm_config.presence_penalty is not None:
        dspy_kwargs["presence_penalty"] = llm_config.presence_penalty
    if llm_config.seed is not None:
        dspy_kwargs["seed"] = llm_config.seed
    if llm_config.top_k is not None:
        dspy_kwargs["top_k"] = llm_config.top_k
    if llm_config.min_p is not None:
        dspy_kwargs["min_p"] = llm_config.min_p
    if llm_config.repetition_penalty is not None:
        dspy_kwargs["repetition_penalty"] = llm_config.repetition_penalty

    # Normalize reasoning from any provider-specific field (for backward compatibility)
    # Then map to the appropriate provider-specific parameter at runtime boundary
    normalized_reasoning = normalize_reasoning_from_provider_fields(llm_config)
    if normalized_reasoning:
        # Map unified reasoning to provider-specific parameter
        reasoning_params = map_reasoning_to_provider(llm_config.model, normalized_reasoning)
        dspy_kwargs.update(reasoning_params)

    return dspy.LM(**dspy_kwargs)


def shutdown_handler(sig, frame):
    timer = threading.Timer(3.0, forceful_exit)
    timer.start()

    try:
        sys.exit(0)
    finally:
        timer.cancel()


def forceful_exit(self):
    print("Forceful exit triggered", file=sys.stderr)
    os._exit(1)


@contextmanager
def optional_langwatch_trace(
    name,
    type,
    do_not_trace=False,
    metadata=None
):
    with langwatch.trace(
        name=name,
        type=type,
        metadata=metadata,
        disable_sending=do_not_trace,
    ) as trace:
        if do_not_trace:
            yield None
        else:
            yield trace


def normalize_name_to_class_name(node_name: str) -> str:
    """
    Converts a node name like "LLM Signature (2)" to a valid Python class name like "LLMSignature2".

    Args:
        node_name: A string representing the node name

    Returns:
        A string representing a valid Python class name
    """
    # Keep only alphanumeric characters
    import re

    class_name = re.sub(r"[^a-zA-Z0-9]", "", node_name).capitalize()

    return class_name


reserved_keywords = [
    "and",
    "as",
    "assert",
    "async",
    "await",
    "break",
    "class",
    "continue",
    "def",
    "del",
    "elif",
    "else",
    "except",
    "finally",
    "for",
    "from",
    "global",
    "if",
    "import",
    "in",
    "is",
    "lambda",
    "nonlocal",
    "not",
    "or",
    "pass",
    "raise",
    "return",
    "try",
    "while",
    "with",
    "yield",
    "items",
]


def normalize_to_variable_name(name: str) -> str:
    """
    Converts a name like "LLM Signature (2)" to a valid Python variable name like "llm_signature_2".

    Args:
        name: A string representing the name
    """

    name = re.sub(r"[^a-zA-Z0-9_]", "", name.strip().replace(" ", "_")).lower()

    if name in reserved_keywords:
        name = f"{name}_"

    return name


def snake_case_to_pascal_case(name: str) -> str:
    return "".join(word.capitalize() for word in name.split("_"))


class SerializableWithPydanticAndPredictEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, dspy.Prediction):
            return o.toDict()
        if isinstance(o, BaseModel):
            return o.model_dump()
        if isinstance(o, enum.Enum):
            return o.value
        if isinstance(o, Iterator):
            return list(o)
        return super().default(o)


class SerializableWithStringFallback(SerializableWithPydanticAndPredictEncoder):
    def default(self, o):
        try:
            return super().default(o)
        except:
            return str(o)


def get_dataset_entry_selection(
    entries: List[Dict[str, Any]],
    entry_selection: str | int = "all",
) -> List[Dict[str, Any]]:
    """
    Select entries from a list based on the entry_selection parameter.
    Returns a list of selected entries.

    Args:
        entries: List of dictionary entries to select from
        entry_selection: Selection mode - "all", "first", "last", "random", or an integer index

    Returns:
        List of selected entries
    """
    if not entries:
        return []

    if isinstance(entry_selection, int):
        if entry_selection < 0 or entry_selection >= len(entries):
            raise ValueError(f"Invalid entry selection index: {entry_selection}")
        return [entries[entry_selection]]
    if entry_selection == "first":
        return entries[:1]
    if entry_selection == "last":
        return entries[-1:]
    if entry_selection == "random":
        return [random.choice(entries)] if entries else []
    return entries
