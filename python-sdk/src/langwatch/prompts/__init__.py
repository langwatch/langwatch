from .prompt_facade import PromptsFacade
from .types import FetchPolicy

__all__ = [
    "PromptsFacade",
    "FetchPolicy",
]

# Cached PromptsFacade instance for module-level method delegation
_facade_instance: PromptsFacade | None = None


def _get_facade() -> PromptsFacade:
    """Get or create the cached PromptsFacade instance."""
    global _facade_instance
    if _facade_instance is None:
        _facade_instance = PromptsFacade.from_global()
    return _facade_instance


def __getattr__(name: str):
    """
    Delegate attribute access to PromptsFacade instance.

    This allows langwatch.prompts to work both as:
    - A module (for submodule access like `from langwatch.prompts.types import FetchPolicy`)
    - A facade (for method access like `langwatch.prompts.get(...)`)

    When Python imports `langwatch.prompts.types`, it stores `langwatch.prompts` as a module
    in sys.modules, which shadows the lazy-loaded PromptsFacade instance from langwatch.__getattr__.
    This __getattr__ ensures method calls still work by delegating to a PromptsFacade instance.
    """
    facade = _get_facade()
    if hasattr(facade, name):
        return getattr(facade, name)
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")
