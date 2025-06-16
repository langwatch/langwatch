from warnings import warn
from .utils.module import module_property
from .telemetry.tracing import trace
from .telemetry.sampling import sampling_rate
from .telemetry.context import get_current_trace, get_current_span
from .telemetry.span import span
from .login import login
from .state import get_api_key, get_endpoint
from .__version__ import __version__
from .utils.initialization import ensure_setup, setup

# Type hints for IntelliSense (only imported for typing)
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import langwatch.evaluations as evaluations
    import langwatch.evaluation as evaluation
    import langwatch.dataset as dataset
    import langwatch.dspy as dspy
    import langwatch.langchain as langchain


@module_property
def _endpoint():
    return get_endpoint()


@module_property
def _api_key():
    return get_api_key()


# Lazy loading configuration
_LAZY_MODULES = {
    "evaluations": "langwatch.evaluations",
    "evaluation": "langwatch.evaluation",
    "dataset": "langwatch.dataset",
    "dspy": "langwatch.dspy",  # Special handling
    "langchain": "langwatch.langchain",  # Special handling
}


def __getattr__(name: str):
    if name in _LAZY_MODULES:
        if name == "dspy":
            return _get_dspy()
        elif name == "langchain":
            return _get_langchain()
        else:
            # Regular module import
            import importlib

            module = importlib.import_module(_LAZY_MODULES[name])
            # Cache it in the module globals for subsequent access
            globals()[name] = module
            return module

    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")


def _get_dspy():
    if hasattr(_get_dspy, "_cached"):
        return _get_dspy._cached

    dspy_available = False
    try:
        import dspy as original_dspy

        dspy_available = True
    except AttributeError as err:
        import pydantic

        if pydantic.__version__.startswith("1."):
            warn(
                "LangWatch detected installed DSPy, however DSPy is not compatible with pydantic 1.x. Please upgrade to pydantic 2.x to use LangWatch DSPy."
            )
        else:
            raise err
    except ImportError:
        pass

    result = None
    if dspy_available:
        try:
            from langwatch.dspy import langwatch_dspy

            result = langwatch_dspy
        except ImportError:
            warn(
                "DSPy seems to be installed but we couldn't import langwatch.dspy, please check your dspy dependency installation."
            )

    _get_dspy._cached = result
    globals()["dspy"] = result
    return result


def _get_langchain():
    if hasattr(_get_langchain, "_cached"):
        return _get_langchain._cached

    langchain_available = False
    try:
        import langchain as original_langchain

        langchain_available = True
    except ImportError:
        pass

    result = None
    if langchain_available:
        try:
            import langwatch.langchain as langwatch_langchain

            result = langwatch_langchain
        except ImportError:
            warn(
                "LangChain seems to be installed but we couldn't import langwatch.langchain, please check your langchain dependency installation."
            )

    _get_langchain._cached = result
    globals()["langchain"] = result
    return result


__all__ = [
    "setup",
    "trace",
    "span",
    "login",
    "endpoint",
    "api_key",
    "__version__",
    "sampling_rate",
    "ensure_setup",
    "get_current_trace",
    "get_current_span",
    "evaluation",
    "dataset",
    "evaluations",
    "langchain",
    "dspy",
]
