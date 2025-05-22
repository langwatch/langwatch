import time
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel

def safe_get(d: Union[Dict[str, Any], BaseModel], *keys: str) -> Optional[Any]:
    for key in keys:
        if isinstance(d, dict):
            d = d.get(key, None)
        if hasattr(d, key):
            d = getattr(d, key)
        else:
            return None
    return d


def list_get(lst: List[Any], i: int, default: Optional[Any] = None) -> Any:
    try:
        return lst[i]
    except IndexError:
        return default


def milliseconds_timestamp():
    return int(time.time() * 1000)
