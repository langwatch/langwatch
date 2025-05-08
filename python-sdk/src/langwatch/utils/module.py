import sys
from typing import Any, Callable

def module_property(func: Callable[[], Any]) -> Callable[[], Any]:
    """Decorator to turn module functions into properties.
    Function names must be prefixed with an underscore."""
    module = sys.modules[func.__module__]

    def base_getattr(name: str) -> Any:
        raise AttributeError(
            f"module '{module.__name__}' has no attribute '{name}'")

    old_getattr = getattr(module, '__getattr__', base_getattr)

    def new_getattr(name: str) -> Any:
        if f'_{name}' == func.__name__:
            return func()
        else:
            return old_getattr(name)

    module.__getattr__ = new_getattr

    return func
