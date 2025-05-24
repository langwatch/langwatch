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
import langwatch.evaluations as evaluations
import langwatch.evaluation as evaluation
import langwatch.dataset as dataset

@module_property
def _endpoint():
    return get_endpoint()
@module_property
def _api_key():
    return get_api_key()


dspy_available = False
try:
    import dspy

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

dspy = None
if dspy_available:
    try:
        from langwatch.dspy import langwatch_dspy

        dspy = langwatch_dspy
    except ImportError:
        warn(
            "DSPy seems to be installed but we couldn't import langwatch.dspy, please check your dspy dependency installation."
        )

langchain_available = False
try:
    import langchain

    langchain_available = True
except ImportError:
    pass

langchain = None
if langchain_available:
    try:
        import langwatch.langchain as langchain
    except ImportError:
        warn(
            "LangChain seems to be installed but we couldn't import langwatch.langchain, please check your langchain dependency installation."
        )

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
