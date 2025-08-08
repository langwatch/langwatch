import warnings

# Deprecation notice on import
warnings.warn(
    "langwatch.prompt is deprecated; use langwatch.prompts instead.",
    category=DeprecationWarning,
    stacklevel=2,
)

# Re-export public API from the new module
from langwatch.prompts import (  # replace `prompts` with your new subpackage name
    get_prompt,
    async_get_prompt,
)

__all__ = [
    "get_prompt",
    "async_get_prompt",
]
