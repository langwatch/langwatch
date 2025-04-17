import time
from typing import Any, Dict, Optional, Union

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


def list_get(l, i, default=None):
    try:
        return l[i]
    except IndexError:
        return default


def milliseconds_timestamp():
    return int(time.time() * 1000)
