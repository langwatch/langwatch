from typing import Any, Dict, Optional


def safe_get(d: Dict[str, Any], *keys: str) -> Optional[Any]:
    for key in keys:
        if not isinstance(d, dict):
            return None
        d = d.get(key) # type: ignore
    return d