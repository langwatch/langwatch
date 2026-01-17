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

from typing import Any, Dict, Iterator, List, cast
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

# Provider-specific reasoning parameter names
# Used as fallback for mapping the unified 'reasoning' field to provider-specific parameters
PROVIDER_REASONING_FALLBACKS: Dict[str, str] = {
    "openai": "reasoning_effort",
    "google": "thinkingLevel",
    "anthropic": "effort",
    "gemini": "thinkingLevel",  # Alias for google
}


def get_provider_from_model(model: str | None) -> str:
    """Extract provider from model string (e.g., 'openai/gpt-4' -> 'openai')."""
    if not model:
        return ""
    return model.split("/")[0].lower() if "/" in model else ""


def map_reasoning_to_provider(model: str | None, reasoning: str | None) -> Dict[str, str]:
    """
    Maps the unified 'reasoning' field to the provider-specific parameter.

    This is the boundary layer function that converts the canonical 'reasoning'
    field to the appropriate provider-specific parameter (reasoning_effort,
    thinkingLevel, effort) when making API calls.

    Args:
        model: The model identifier (e.g., "openai/gpt-5", "gemini/gemini-3-flash")
        reasoning: The unified reasoning value

    Returns:
        Dict with provider-specific key and value, or empty dict if reasoning is not set
    """
    if not reasoning:
        return {}

    provider = get_provider_from_model(model)
    param_key = PROVIDER_REASONING_FALLBACKS.get(provider, "reasoning_effort")

    return {param_key: reasoning}


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

    For reasoning models (o1, o3, o4, o5, gpt-5):
    - temperature: 1.0 (required by DSPy, which handles the API call internally)
    - max_tokens: at least 16000

    For non-reasoning models:
    - temperature: config value or 0
    - max_tokens: config value or 2048
    """
    if is_reasoning_model(llm_config.model):
        return {
            "temperature": 1.0,
            "max_tokens": max(
                llm_config.max_tokens or REASONING_MODEL_MIN_MAX_TOKENS,
                REASONING_MODEL_MIN_MAX_TOKENS,
            ),
        }
    return {
        "temperature": llm_config.temperature or 0,
        "max_tokens": llm_config.max_tokens or 2048,
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
    do_not_trace=False, trace_id=None, skip_root_span=False, metadata=None
):
    with langwatch.trace(
        trace_id=trace_id,
        skip_root_span=skip_root_span,
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
